import { describe, expect, it } from 'vitest';
import {
  wrapSelection,
  wrapKeyShortcut,
  shortcutFor,
} from './editing';

const sel = (text: string, start: number, end: number = start) => ({ text, start, end });

describe('wrapSelection — aplicar', () => {
  it('envolve a seleção com *', () => {
    const r = wrapSelection(sel('olá mundo', 0, 3), 'bold');
    expect(r.text).toBe('*olá* mundo');
    expect(r.changed).toBe(true);
  });

  it('coloca o cursor após o conteúdo formatado', () => {
    const r = wrapSelection(sel('olá mundo', 0, 3), 'bold');
    expect(r.caret).toBe(4); // 1 (* ) + 3 (olá)
  });

  it('envolve com _ para itálico', () => {
    const r = wrapSelection(sel('texto importante aqui', 6, 16), 'italic');
    expect(r.text).toBe('texto _importante_ aqui');
  });

  it('seleção vazia com cursor sobre palavra: aplica na palavra inteira', () => {
    // Cursor no início de "mundo" (índice 4).
    const r = wrapSelection(sel('olá mundo', 4), 'bold');
    expect(r.text).toBe('olá *mundo*');
  });

  it('seleção vazia em espaço vazio: insere marcadores vazios no cursor', () => {
    const r = wrapSelection(sel('olá ', 4), 'bold');
    // O cursor está no espaço depois de "olá" — sem palavra para pegar.
    expect(r.text).toBe('olá **');
    expect(r.caret).toBe(5); // depois do primeiro *
  });

  it('funciona no fim do texto', () => {
    const r = wrapSelection(sel('olá', 3), 'bold');
    // Cursor no fim, sobre a última letra: pega "olá" inteiro.
    expect(r.text).toBe('*olá*');
  });
});

describe('wrapSelection — toggle de remoção', () => {
  it('remove quando a seleção está envolvida', () => {
    // Seleção "mundo", dentro de *mundo*.
    const r = wrapSelection(sel('olá *mundo* fora', 5, 10), 'bold');
    expect(r.text).toBe('olá mundo fora');
    expect(r.changed).toBe(true);
  });

  it('remove quando a seleção INCLUI os marcadores', () => {
    const r = wrapSelection(sel('olá *mundo* fora', 4, 11), 'bold');
    expect(r.text).toBe('olá mundo fora');
  });

  it('toggle de itálico não interfere no negrito', () => {
    // *negrito* com _itálico_ dentro: remover itálico preserva o negrito.
    const r = wrapSelection(sel('*a _b_ c*', 3, 6), 'italic');
    expect(r.text).toBe('*a b c*');
  });
});

describe('atalhos de teclado', () => {
  it('Ctrl+B → bold', () => {
    expect(shortcutFor({ key: 'b', ctrlKey: true, metaKey: false, shiftKey: false })).toBe('bold');
  });

  it('Ctrl+I → italic', () => {
    expect(shortcutFor({ key: 'i', ctrlKey: true, metaKey: false, shiftKey: false })).toBe('italic');
  });

  it('Ctrl+Shift+X → strike', () => {
    expect(shortcutFor({ key: 'x', ctrlKey: true, metaKey: false, shiftKey: true })).toBe('strike');
  });

  it('Ctrl+E → code', () => {
    expect(shortcutFor({ key: 'e', ctrlKey: true, metaKey: false, shiftKey: false })).toBe('code');
  });

  it('sem modificador → null', () => {
    expect(shortcutFor({ key: 'b', ctrlKey: false, metaKey: false, shiftKey: false })).toBeNull();
  });

  it('Ctrl+Shift+B → null (não é atalho nosso)', () => {
    expect(shortcutFor({ key: 'b', ctrlKey: true, metaKey: false, shiftKey: true })).toBeNull();
  });

  it('Cmd+B (macOS) → bold', () => {
    expect(shortcutFor({ key: 'b', ctrlKey: false, metaKey: true, shiftKey: false })).toBe('bold');
  });

  it('Ctrl+B aplica no texto via wrapKeyShortcut', () => {
    const r = wrapKeyShortcut(sel('olá mundo', 0, 3), {
      key: 'b', ctrlKey: true, metaKey: false, shiftKey: false,
    });
    expect(r.text).toBe('*olá* mundo');
    expect(r.changed).toBe(true);
  });

  it('tecla sem atalho devolve o texto inalterado', () => {
    const r = wrapKeyShortcut(sel('olá', 0, 3), {
      key: 'z', ctrlKey: true, metaKey: false, shiftKey: false,
    });
    expect(r.text).toBe('olá');
    expect(r.changed).toBe(false);
  });
});

describe('casos de borda', () => {
  it('texto vazio com Ctrl+B insere **', () => {
    const r = wrapKeyShortcut(sel('', 0), {
      key: 'b', ctrlKey: true, metaKey: false, shiftKey: false,
    });
    expect(r.text).toBe('**');
    expect(r.caret).toBe(1);
  });

  it('aplicar duas vezes o mesmo formato volta ao original (toggle duplo)', () => {
    const first = wrapSelection(sel('olá mundo', 0, 4), 'bold');
    // Seleção volta para dentro dos marcadores: 1..5 em "*olá* mundo".
    const second = wrapSelection(sel(first.text, 1, 5), 'bold');
    expect(second.text).toBe('olá mundo');
  });

  it('formatação dentro de formatação diferente coexiste', () => {
    const bold = wrapSelection(sel('texto importante', 0, 5), 'bold');
    // "*texto* importante" — aplica itálico em "importante" (6..16 → +2 por *)
    const italic = wrapSelection(sel(bold.text, 8, 18), 'italic');
    expect(italic.text).toBe('*texto* _importante_');
  });
});
