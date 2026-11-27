import { describe, expect, it, vi } from 'vitest';

import {
  SCROLL_TO_BOTTOM_THRESHOLD_PX,
  distanceFromBottom,
  scrollElementToBottom,
  shouldShowScrollToBottom,
} from './scroll-to-bottom';

describe('distanceFromBottom', () => {
  it('devolve 0 quando já está exatamente no final', () => {
    expect(
      distanceFromBottom({ scrollHeight: 2000, scrollTop: 1400, clientHeight: 600 }),
    ).toBe(0);
  });

  it('devolve a distância restante em pixels', () => {
    expect(
      distanceFromBottom({ scrollHeight: 2000, scrollTop: 1000, clientHeight: 600 }),
    ).toBe(400);
  });

  it('trava em 0 no bounce elástico (iOS/macOS)', () => {
    expect(
      distanceFromBottom({ scrollHeight: 2000, scrollTop: 1450, clientHeight: 600 }),
    ).toBe(0);
  });

  it('devolve 0 para valores não finitos', () => {
    expect(
      distanceFromBottom({ scrollHeight: Number.NaN, scrollTop: 0, clientHeight: 600 }),
    ).toBe(0);
  });
});

describe('shouldShowScrollToBottom', () => {
  it('esconde quando está no final', () => {
    expect(
      shouldShowScrollToBottom({
        scrollHeight: 2000,
        scrollTop: 1400,
        clientHeight: 600,
      }),
    ).toBe(false);
  });

  it('esconde dentro do limiar e exatamente na borda', () => {
    expect(
      shouldShowScrollToBottom({
        scrollHeight: 2000,
        scrollTop: 1400 - SCROLL_TO_BOTTOM_THRESHOLD_PX,
        clientHeight: 600,
      }),
    ).toBe(false);

    expect(
      shouldShowScrollToBottom({
        scrollHeight: 2000,
        scrollTop: 1400 - 20,
        clientHeight: 600,
      }),
    ).toBe(false);
  });

  it('mostra assim que passa do limiar', () => {
    expect(
      shouldShowScrollToBottom({
        scrollHeight: 2000,
        scrollTop: 1400 - SCROLL_TO_BOTTOM_THRESHOLD_PX - 1,
        clientHeight: 600,
      }),
    ).toBe(true);
  });

  it('mostra quando abriu no topo de uma conversa longa', () => {
    expect(
      shouldShowScrollToBottom({
        scrollHeight: 3500,
        scrollTop: 0,
        clientHeight: 600,
      }),
    ).toBe(true);
  });

  it('esconde em conversas curtas sem barra de rolagem', () => {
    expect(
      shouldShowScrollToBottom({
        scrollHeight: 400,
        scrollTop: 0,
        clientHeight: 600,
      }),
    ).toBe(false);
  });

  it('esconde quando o contêiner ainda não tem altura medida', () => {
    expect(
      shouldShowScrollToBottom({
        scrollHeight: 1200,
        scrollTop: 0,
        clientHeight: 0,
      }),
    ).toBe(false);
  });
});

describe('scrollElementToBottom', () => {
  it('usa scrollTo com behavior smooth por padrão', () => {
    const scrollTo = vi.fn();
    scrollElementToBottom({ scrollHeight: 2400, scrollTop: 0, scrollTo });

    expect(scrollTo).toHaveBeenCalledWith({ top: 2400, behavior: 'smooth' });
  });

  it('permite escolher behavior auto (reduced motion)', () => {
    const scrollTo = vi.fn();
    scrollElementToBottom({ scrollHeight: 2400, scrollTop: 0, scrollTo }, 'auto');

    expect(scrollTo).toHaveBeenCalledWith({ top: 2400, behavior: 'auto' });
  });

  it('cai para scrollTop quando scrollTo não existe', () => {
    const el = { scrollHeight: 2400, scrollTop: 120 };
    scrollElementToBottom(el);

    expect(el.scrollTop).toBe(2400);
  });
});
