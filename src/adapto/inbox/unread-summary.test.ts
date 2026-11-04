import { describe, expect, it } from 'vitest';

import {
  bellHref,
  formatUnreadBadge,
  shouldShowUnreadIndicator,
} from './unread-summary';

describe('formatUnreadBadge', () => {
  it('devolve null sem não-lidas', () => {
    // `null` em vez de "0": o chamador não desenha o badge, e o tipo
    // distingue "sem badge" de "badge com texto vazio".
    expect(formatUnreadBadge(0)).toBeNull();
  });

  it('devolve null para valores negativos', () => {
    // A contagem vem de um Set e de deltas de realtime; um delta a menos
    // não pode virar badge "-1".
    expect(formatUnreadBadge(-1)).toBeNull();
    expect(formatUnreadBadge(-99)).toBeNull();
  });

  it('mostra o número de 1 a 9', () => {
    expect(formatUnreadBadge(1)).toBe('1');
    expect(formatUnreadBadge(5)).toBe('5');
    expect(formatUnreadBadge(9)).toBe('9');
  });

  it('vira "9+" a partir de 10', () => {
    // Mantém a largura do cabeçalho estável: "128" empurraria o título.
    expect(formatUnreadBadge(10)).toBe('9+');
    expect(formatUnreadBadge(42)).toBe('9+');
    expect(formatUnreadBadge(999)).toBe('9+');
  });

  it('trunca frações para baixo', () => {
    expect(formatUnreadBadge(3.9)).toBe('3');
  });

  it('trata valores não finitos como ausência de badge', () => {
    // NaN surgiria de uma divisão inválida em algum consumidor futuro.
    expect(formatUnreadBadge(Number.NaN)).toBeNull();
    expect(formatUnreadBadge(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('shouldShowUnreadIndicator', () => {
  it('mostra o indicador quando há não-lidas', () => {
    expect(
      shouldShowUnreadIndicator({ total: 1, isActiveSection: false })
    ).toBe(true);
  });

  it('mostra o indicador MESMO na seção ativa', () => {
    // Regressão do bug relatado: a versão anterior tinha `!isActive` na
    // condição, então o aviso sumia justamente quando o usuário abria o
    // inbox para procurá-lo.
    expect(
      shouldShowUnreadIndicator({ total: 1, isActiveSection: true })
    ).toBe(true);
    expect(
      shouldShowUnreadIndicator({ total: 7, isActiveSection: true })
    ).toBe(true);
  });

  it('esconde o indicador quando não há não-lidas', () => {
    expect(
      shouldShowUnreadIndicator({ total: 0, isActiveSection: false })
    ).toBe(false);
    expect(
      shouldShowUnreadIndicator({ total: 0, isActiveSection: true })
    ).toBe(false);
  });

  it('concorda com formatUnreadBadge em todos os casos', () => {
    // As duas funções precisam concordar, senão o indicador aparece
    // vazio ou some com contagem pendente.
    for (const total of [-5, 0, 1, 9, 10, 100]) {
      expect(
        shouldShowUnreadIndicator({ total, isActiveSection: false })
      ).toBe(formatUnreadBadge(total) !== null);
    }
  });
});

describe('bellHref', () => {
  it('aponta para o inbox filtrado por não-lidas', () => {
    expect(bellHref()).toBe('/inbox?filter=unread');
  });

  it('usa um valor de filtro que o inbox reconhece', () => {
    // `parseInboxFilter` faz fallback silencioso para "all" quando o valor
    // não está em INBOX_FILTERS — um typo aqui viraria "mostrar tudo" sem
    // erro nenhum, que é pior que quebrar.
    expect(bellHref()).toContain('filter=unread');
  });
});
