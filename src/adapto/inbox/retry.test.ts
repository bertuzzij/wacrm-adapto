import { describe, expect, it } from 'vitest';

import {
  RETRY_CONFIRM_AFTER_MS,
  canRetry,
  failedDraftFrom,
  retryNeedsConfirm,
} from './retry';

const failed = {
  id: 'abc',
  status: 'failed' as const,
  content_type: 'text' as const,
  content_text: 'Bom dia',
  reply_to_message_id: null,
  created_at: '2026-11-06T12:00:00Z',
};

describe('canRetry', () => {
  it('permite reenviar mensagem de texto que falhou', () => {
    expect(canRetry(failed)).toBe(true);
  });

  it('recusa mensagem que não falhou', () => {
    expect(canRetry({ ...failed, status: 'sent' })).toBe(false);
    expect(canRetry({ ...failed, status: 'delivered' })).toBe(false);
    expect(canRetry({ ...failed, status: 'sending' })).toBe(false);
  });

  it('recusa mídia: o reenvio mandaria texto vazio', () => {
    // O arquivo já está no Storage; reconstruir o payload de mídia é outro
    // caminho, e mandar só o texto criaria uma mensagem sem o anexo.
    expect(canRetry({ ...failed, content_type: 'image' })).toBe(false);
    expect(canRetry({ ...failed, content_type: 'document' })).toBe(false);
  });

  it('recusa template', () => {
    expect(canRetry({ ...failed, content_type: 'template' })).toBe(false);
  });

  it('recusa texto vazio', () => {
    expect(canRetry({ ...failed, content_text: '' })).toBe(false);
    expect(canRetry({ ...failed, content_text: '   ' })).toBe(false);
    expect(canRetry({ ...failed, content_text: undefined })).toBe(false);
  });
});

describe('failedDraftFrom', () => {
  it('monta o rascunho com texto e citação', () => {
    const draft = failedDraftFrom({
      ...failed,
      reply_to_message_id: 'orig-1',
    } as never);

    expect(draft).toEqual({
      tempId: 'abc',
      text: 'Bom dia',
      replyToId: 'orig-1',
    });
  });

  it('devolve null quando não é reenviável', () => {
    expect(failedDraftFrom({ ...failed, status: 'sent' } as never)).toBeNull();
  });
});

describe('retryNeedsConfirm', () => {
  const base = { created_at: '2026-11-06T12:00:00Z' };
  const t0 = new Date(base.created_at).getTime();

  it('não pede confirmação dentro da janela', () => {
    // Caso comum: falhou agora (timeout, rede). Uma confirmação a cada
    // tentativa só atrapalharia.
    expect(retryNeedsConfirm(base, t0 + 5_000)).toBe(false);
    expect(retryNeedsConfirm(base, t0 + RETRY_CONFIRM_AFTER_MS - 1)).toBe(false);
  });

  it('pede confirmação depois da janela', () => {
    // Pode ter chegado e o status ficado dessincronizado; mandar de novo
    // duplicaria do lado do cliente, sem desfazer.
    expect(retryNeedsConfirm(base, t0 + RETRY_CONFIRM_AFTER_MS + 1)).toBe(true);
    expect(retryNeedsConfirm(base, t0 + 3_600_000)).toBe(true);
  });

  it('pede confirmação quando a data é inválida', () => {
    expect(retryNeedsConfirm({ created_at: 'nao-e-data' }, t0)).toBe(true);
  });
});
