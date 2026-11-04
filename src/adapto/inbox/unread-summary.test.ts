import { describe, expect, it } from 'vitest';

import {
  bellHref,
  bellPrimaryHref,
  bellSections,
  bellTotal,
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

// ============================================================
// O sino junta duas origens. Somar num número só esconderia a diferença
// entre "o cliente está esperando" e "te passaram uma conversa".
// ============================================================

describe('bellSections', () => {
  it('separa inbox de atribuição, cada uma com seu destino', () => {
    const sections = bellSections({
      unreadConversations: 3,
      unreadNotifications: 2,
    });
    expect(sections).toEqual([
      { source: 'inbox', count: 3, href: '/inbox?filter=unread' },
      { source: 'assignment', count: 2, href: '/notifications' },
    ]);
  });

  it('põe o inbox primeiro, porque tem prazo de resposta', () => {
    const [first] = bellSections({
      unreadConversations: 1,
      unreadNotifications: 9,
    });
    expect(first.source).toBe('inbox');
  });

  it('omite categoria zerada em vez de mostrar "(0)"', () => {
    expect(
      bellSections({ unreadConversations: 2, unreadNotifications: 0 })
    ).toEqual([{ source: 'inbox', count: 2, href: '/inbox?filter=unread' }]);
    expect(
      bellSections({ unreadConversations: 0, unreadNotifications: 4 })
    ).toEqual([
      { source: 'assignment', count: 4, href: '/notifications' },
    ]);
  });

  it('devolve lista vazia quando não há nada', () => {
    expect(
      bellSections({ unreadConversations: 0, unreadNotifications: 0 })
    ).toEqual([]);
  });

  it('descarta contagens inválidas em vez de propagar NaN', () => {
    expect(
      bellSections({
        unreadConversations: Number.NaN,
        unreadNotifications: -3,
      })
    ).toEqual([]);
  });

  it('trunca frações, como o badge faz', () => {
    const [first] = bellSections({
      unreadConversations: 2.9,
      unreadNotifications: 0,
    });
    expect(first.count).toBe(2);
  });
});

describe('bellTotal', () => {
  it('soma as duas origens', () => {
    expect(
      bellTotal({ unreadConversations: 3, unreadNotifications: 2 })
    ).toBe(5);
  });

  it('é zero quando não há nada pendente', () => {
    expect(
      bellTotal({ unreadConversations: 0, unreadNotifications: 0 })
    ).toBe(0);
  });

  it('concorda com as seções exibidas', () => {
    // O badge não pode mostrar um número diferente da soma do painel.
    const counts = { unreadConversations: 4, unreadNotifications: 1 };
    const somaDasSecoes = bellSections(counts).reduce(
      (n, s) => n + s.count,
      0
    );
    expect(bellTotal(counts)).toBe(somaDasSecoes);
  });

  it('ignora valores inválidos', () => {
    expect(
      bellTotal({
        unreadConversations: Number.NaN,
        unreadNotifications: 2,
      })
    ).toBe(2);
  });
});

describe('bellPrimaryHref', () => {
  it('vai para o inbox quando só há mensagem', () => {
    expect(
      bellPrimaryHref({ unreadConversations: 2, unreadNotifications: 0 })
    ).toBe('/inbox?filter=unread');
  });

  it('vai para notificações quando só há atribuição', () => {
    expect(
      bellPrimaryHref({ unreadConversations: 0, unreadNotifications: 3 })
    ).toBe('/notifications');
  });

  it('prioriza o inbox quando há as duas origens', () => {
    expect(
      bellPrimaryHref({ unreadConversations: 1, unreadNotifications: 5 })
    ).toBe('/inbox?filter=unread');
  });

  it('sem nada pendente vai para o inbox mesmo assim', () => {
    // É onde o trabalho acontece; melhor que um clique morto.
    expect(
      bellPrimaryHref({ unreadConversations: 0, unreadNotifications: 0 })
    ).toBe('/inbox?filter=unread');
  });
});
