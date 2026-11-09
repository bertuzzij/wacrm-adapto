import { describe, expect, it } from 'vitest';

import {
  LARGE_VIDEO_BYTES,
  formatBytes,
  isLargeVideo,
  videoCardSubtitle,
  videoPresentation,
} from './decision';

describe('formatBytes', () => {
  it('devolve null para tamanho desconhecido', () => {
    // Não é zero: "0 B" mentiria sobre o arquivo. As mensagens anteriores
    // a esta mudança não guardaram o tamanho.
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(undefined)).toBeNull();
    expect(formatBytes(0)).toBeNull();
    expect(formatBytes(Number.NaN)).toBeNull();
    expect(formatBytes(-5)).toBeNull();
  });

  it('formata bytes, KB e MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('usa uma casa decimal abaixo de 10 MB e nenhuma acima', () => {
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
    expect(formatBytes(27.8 * 1024 * 1024)).toBe('28 MB');
  });

  it('lida com os tamanhos reais da conta', () => {
    // Os vídeos medidos no WAHA: 300 MB, 148 MB, 43 MB.
    expect(formatBytes(300 * 1024 * 1024)).toBe('300 MB');
    expect(formatBytes(148.7 * 1024 * 1024)).toBe('149 MB');
    expect(formatBytes(43.9 * 1024 * 1024)).toBe('44 MB');
  });
});

describe('isLargeVideo', () => {
  it('marca acima do limite e não abaixo', () => {
    expect(isLargeVideo(LARGE_VIDEO_BYTES)).toBe(false);
    expect(isLargeVideo(LARGE_VIDEO_BYTES + 1)).toBe(true);
    expect(isLargeVideo(1024)).toBe(false);
  });

  it('tamanho desconhecido não é "grande"', () => {
    expect(isLargeVideo(null)).toBe(false);
    expect(isLargeVideo(Number.NaN)).toBe(false);
  });
});

describe('videoPresentation', () => {
  it('oferece player para vídeo de tamanho normal', () => {
    expect(videoPresentation(2 * 1024 * 1024)).toBe('card');
    expect(videoPresentation(20 * 1024 * 1024)).toBe('card');
  });

  it('oferece player mesmo para vídeo grande mas tocável', () => {
    // 43 MB: carrega sob demanda, com aviso — mas ainda vale o play.
    expect(videoPresentation(43 * 1024 * 1024)).toBe('card');
  });

  it('vira somente-download quando o arquivo é absurdo', () => {
    // 300 MB: mesmo sob demanda a espera trava a tela.
    expect(videoPresentation(300 * 1024 * 1024)).toBe('download-only');
    expect(videoPresentation(LARGE_VIDEO_BYTES * 4 + 1)).toBe('download-only');
  });

  it('sem tamanho conhecido, trata como tocável', () => {
    // Recusar o player por falta de metadado puniria as mensagens antigas,
    // que são a maioria do acervo.
    expect(videoPresentation(null)).toBe('card');
    expect(videoPresentation(undefined)).toBe('card');
  });
});

describe('videoCardSubtitle', () => {
  const labels = { large: 'arquivo grande', video: 'Vídeo' };

  it('mostra só o tamanho quando é pequeno', () => {
    expect(videoCardSubtitle(2 * 1024 * 1024, labels)).toBe('2.0 MB');
  });

  it('acrescenta o aviso quando é grande', () => {
    const out = videoCardSubtitle(300 * 1024 * 1024, labels);
    expect(out).toContain('300 MB');
    expect(out).toContain('arquivo grande');
  });

  it('cai no rótulo genérico sem tamanho', () => {
    expect(videoCardSubtitle(null, labels)).toBe('Vídeo');
  });
});
