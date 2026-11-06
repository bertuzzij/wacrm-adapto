import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SOUND_CHANGE_EVENT,
  readSoundPref,
  subscribeSoundPref,
  writeSoundPref,
} from './sound';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  } as unknown as Storage;
}

describe('readSoundPref', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('vem ligado por padrão', () => {
    // O recurso foi pedido para receber aviso; quem não quiser desliga.
    vi.stubGlobal('window', { localStorage: fakeStorage() });
    expect(readSoundPref()).toBe(true);
  });

  it('respeita o desligado explícito', () => {
    vi.stubGlobal('window', {
      localStorage: fakeStorage({ 'adapto.notify.sound.v1': 'false' }),
    });
    expect(readSoundPref()).toBe(false);
  });

  it('assume ligado quando o storage está bloqueado', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem() {
          throw new Error('blocked');
        },
      },
    });
    expect(readSoundPref()).toBe(true);
  });

  it('assume ligado sem window (SSR)', () => {
    vi.stubGlobal('window', undefined);
    expect(readSoundPref()).toBe(true);
  });
});

describe('writeSoundPref', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = fakeStorage();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('grava e emite o evento de mudança', () => {
    const dispatch = vi.fn();
    vi.stubGlobal('window', {
      localStorage: storage,
      dispatchEvent: dispatch,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    writeSoundPref(false);

    expect(storage.getItem('adapto.notify.sound.v1')).toBe('false');
    // Sem o evento, o listener já montado continuaria com a preferência
    // antiga até recarregar a página.
    expect(dispatch).toHaveBeenCalledTimes(1);
    const event = dispatch.mock.calls[0][0] as Event;
    expect(event.type).toBe(SOUND_CHANGE_EVENT);
  });

  it('não lança quando o storage recusa', () => {
    vi.stubGlobal('window', {
      localStorage: {
        setItem() {
          throw new Error('quota');
        },
      },
      dispatchEvent: vi.fn(),
    });
    expect(() => writeSoundPref(true)).not.toThrow();
  });
});

describe('subscribeSoundPref', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('escuta o evento local e o de outra aba', () => {
    const added: string[] = [];
    vi.stubGlobal('window', {
      addEventListener: (name: string) => added.push(name),
      removeEventListener: vi.fn(),
    });

    subscribeSoundPref(() => {});

    expect(added).toContain(SOUND_CHANGE_EVENT);
    // `storage` é o único evento que outra aba dispara.
    expect(added).toContain('storage');
  });

  it('devolve um no-op sem window', () => {
    vi.stubGlobal('window', undefined);
    expect(() => subscribeSoundPref(() => {})()).not.toThrow();
  });
});
