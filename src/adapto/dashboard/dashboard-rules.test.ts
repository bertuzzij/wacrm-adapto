import { describe, expect, it } from 'vitest';

import {
  shouldShowQueueWindowBadge,
  showWindowClosingCard,
  waitingQueueHref,
} from './dashboard-rules';

describe('showWindowClosingCard', () => {
  it('mostra quando a janela de 24h está ativa ou ausente (payload legado)', () => {
    expect(showWindowClosingCard(true)).toBe(true);
    expect(showWindowClosingCard(undefined)).toBe(true);
  });

  it('esconde quando a janela de 24h está desligada (modo WAHA)', () => {
    expect(showWindowClosingCard(false)).toBe(false);
  });
});

describe('shouldShowQueueWindowBadge', () => {
  it('nunca mostra selo de janela quando enforceMessagingWindow é false', () => {
    expect(shouldShowQueueWindowBadge(false, 45, 120)).toBe(false);
    expect(shouldShowQueueWindowBadge(false, 1, 120)).toBe(false);
  });

  it('mostra dentro do limite quando a janela está ativa ou ausente', () => {
    expect(shouldShowQueueWindowBadge(true, 45, 120)).toBe(true);
    expect(shouldShowQueueWindowBadge(true, 120, 120)).toBe(true);
    expect(shouldShowQueueWindowBadge(undefined, 30, 120)).toBe(true);
  });

  it('esconde quando já expirou ou falta mais que o limite', () => {
    expect(shouldShowQueueWindowBadge(true, 0, 120)).toBe(false);
    expect(shouldShowQueueWindowBadge(true, -10, 120)).toBe(false);
    expect(shouldShowQueueWindowBadge(true, 121, 120)).toBe(false);
  });
});

describe('waitingQueueHref', () => {
  it('leva para /inbox?filter=unread quando a regra de não lidas está ativa', () => {
    expect(waitingQueueHref(true)).toBe('/inbox?filter=unread');
  });

  it('mantém /inbox?filter=waiting quando desligada ou ausente', () => {
    expect(waitingQueueHref(false)).toBe('/inbox?filter=waiting');
    expect(waitingQueueHref(undefined)).toBe('/inbox?filter=waiting');
  });
});
