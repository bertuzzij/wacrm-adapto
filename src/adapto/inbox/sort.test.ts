import { describe, expect, it } from 'vitest';

import { compareConversations, isPinned, sortConversations } from './sort';

const conv = (
  id: string,
  last: string | null,
  pinned: string | null = null
) => ({ id, last_message_at: last, pinned_at: pinned });

describe('sortConversations', () => {
  it('ordena por última mensagem, mais recente primeiro', () => {
    const out = sortConversations([
      conv('antiga', '2026-11-01T10:00:00Z'),
      conv('nova', '2026-11-05T10:00:00Z'),
      conv('meio', '2026-11-03T10:00:00Z'),
    ]);
    expect(out.map((c) => c.id)).toEqual(['nova', 'meio', 'antiga']);
  });

  it('põe fixadas acima de tudo, mesmo sem mensagem recente', () => {
    // É o ponto do recurso: a conversa fixada não pode afundar porque
    // outras receberam mensagem.
    const out = sortConversations([
      conv('recente', '2026-11-06T10:00:00Z'),
      conv('fixada-velha', '2026-10-01T10:00:00Z', '2026-11-01T09:00:00Z'),
    ]);
    expect(out.map((c) => c.id)).toEqual(['fixada-velha', 'recente']);
  });

  it('entre fixadas, a fixada mais recentemente vem primeiro', () => {
    const out = sortConversations([
      conv('fix-antes', null, '2026-11-01T09:00:00Z'),
      conv('fix-depois', null, '2026-11-05T09:00:00Z'),
    ]);
    expect(out.map((c) => c.id)).toEqual(['fix-depois', 'fix-antes']);
  });

  it('mantém a ordem relativa das não-fixadas sob as fixadas', () => {
    const out = sortConversations([
      conv('n1', '2026-11-02T00:00:00Z'),
      conv('f1', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z'),
      conv('n2', '2026-11-05T00:00:00Z'),
    ]);
    expect(out.map((c) => c.id)).toEqual(['f1', 'n2', 'n1']);
  });

  it('conversa sem mensagem vai para o fim, não para o topo', () => {
    // Criada mas silenciosa não deve empurrar quem está conversando.
    const out = sortConversations([
      conv('sem-mensagem', null),
      conv('com-mensagem', '2026-11-05T00:00:00Z'),
    ]);
    expect(out.map((c) => c.id)).toEqual(['com-mensagem', 'sem-mensagem']);
  });

  it('funciona com várias conversas de cada tipo misturadas', () => {
    const out = sortConversations([
      conv('a', '2026-11-01T00:00:00Z'),
      conv('p1', '2026-10-01T00:00:00Z', '2026-11-04T00:00:00Z'),
      conv('b', '2026-11-06T00:00:00Z'),
      conv('p2', '2026-10-02T00:00:00Z', '2026-11-05T00:00:00Z'),
      conv('c', '2026-11-02T00:00:00Z'),
    ]);
    expect(out.map((c) => c.id)).toEqual(['p2', 'p1', 'b', 'c', 'a']);
  });

  it('não muta o array recebido', () => {
    // Ordenar no lugar um array vindo do estado do React faz a lista mudar
    // sem o React perceber, porque a referência continua a mesma.
    const input = [
      conv('b', '2026-11-01T00:00:00Z'),
      conv('a', '2026-11-05T00:00:00Z'),
    ];
    const snapshot = input.map((c) => c.id);

    sortConversations(input);

    expect(input.map((c) => c.id)).toEqual(snapshot);
  });

  it('compara datas, não strings', () => {
    // "2026-11-05T10:00:00+03:00" é 07:00Z — mais antiga que "2026-11-05T09:00:00Z",
    // embora a string seja "maior". Comparar string erraria aqui.
    const out = sortConversations([
      conv('com-offset', '2026-11-05T10:00:00+03:00'),
      conv('zulu', '2026-11-05T09:00:00Z'),
    ]);
    expect(out.map((c) => c.id)).toEqual(['zulu', 'com-offset']);
  });

  it('tolera timestamp inválido sem quebrar a ordem', () => {
    const out = sortConversations([
      conv('invalida', 'nao-e-data'),
      conv('valida', '2026-11-05T00:00:00Z'),
    ]);
    expect(out.map((c) => c.id)).toEqual(['valida', 'invalida']);
  });
});

describe('isPinned', () => {
  it('reconhece fixada e não fixada', () => {
    expect(isPinned({ pinned_at: '2026-11-05T00:00:00Z' })).toBe(true);
    expect(isPinned({ pinned_at: null })).toBe(false);
    expect(isPinned({})).toBe(false);
  });
});

describe('compareConversations', () => {
  it('devolve 0 quando ambas são iguais em tudo', () => {
    const a = conv('x', '2026-11-05T00:00:00Z');
    const b = conv('y', '2026-11-05T00:00:00Z');
    expect(compareConversations(a, b)).toBe(0);
  });
});
