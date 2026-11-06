import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COLLAPSED_WIDTH_PX,
  readCollapsedPreference,
  writeCollapsedPreference,
} from './use-sidebar-collapsed';

/** Storage mínimo em memória, para testar sem DOM. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

describe('readCollapsedPreference', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('devolve false quando nunca foi salvo', () => {
    vi.stubGlobal('window', { localStorage: fakeStorage() });
    expect(readCollapsedPreference()).toBe(false);
  });

  it('lê o valor salvo', () => {
    vi.stubGlobal('window', {
      localStorage: fakeStorage({ 'adapto.sidebar.collapsed.v1': 'true' }),
    });
    expect(readCollapsedPreference()).toBe(true);
  });

  it('devolve false quando o storage está bloqueado', () => {
    // Modo restrito, cota estourada, storage desabilitado por política.
    vi.stubGlobal('window', {
      localStorage: {
        getItem() {
          throw new Error('blocked');
        },
      },
    });
    expect(readCollapsedPreference()).toBe(false);
  });

  it('devolve false sem window (SSR)', () => {
    vi.stubGlobal('window', undefined);
    expect(readCollapsedPreference()).toBe(false);
  });
});

describe('writeCollapsedPreference', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('grava a escolha', () => {
    const storage = fakeStorage();
    vi.stubGlobal('window', { localStorage: storage });
    writeCollapsedPreference(true);
    expect(storage.getItem('adapto.sidebar.collapsed.v1')).toBe('true');
  });

  it('não lança quando o storage recusa', () => {
    vi.stubGlobal('window', {
      localStorage: {
        setItem() {
          throw new Error('quota');
        },
      },
    });
    // O menu funciona sem persistir; um throw aqui derrubaria o clique.
    expect(() => writeCollapsedPreference(true)).not.toThrow();
  });
});

describe('largura colapsada', () => {
  it('cabe um alvo de toque confortável', () => {
    // Abaixo de 56px os ícones ficam apertados demais para clique.
    expect(COLLAPSED_WIDTH_PX).toBeGreaterThanOrEqual(56);
  });

  it('libera espaço real em relação ao menu expandido', () => {
    // O menu tem 240px (lg:w-60); o ganho é o que justifica o recurso.
    expect(240 - COLLAPSED_WIDTH_PX).toBeGreaterThanOrEqual(160);
  });
});
