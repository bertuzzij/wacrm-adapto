import { describe, expect, it } from 'vitest';

import { insertEmojiAtSelection } from './insert-emoji';

describe('insertEmojiAtSelection', () => {
  it('insere no texto vazio', () => {
    const r = insertEmojiAtSelection('', '😀', 0, 0);

    expect(r.text).toBe('😀');
    expect(r.caret).toBe(2); // 😀 ocupa 2 unidades de código UTF-16
  });

  it('insere no fim quando o cursor está no fim', () => {
    const r = insertEmojiAtSelection('oi', '😀', 2, 2);

    expect(r.text).toBe('oi😀');
    expect(r.caret).toBe(4);
  });

  it('insere no meio, não no fim', () => {
    // O caso que motivou a função: `text + emoji` poria o emoji depois de
    // "mundo", que não é onde o cursor está.
    const r = insertEmojiAtSelection('ola mundo', '😀', 4, 4);

    expect(r.text).toBe('ola 😀mundo');
    expect(r.caret).toBe(6);
  });

  it('substitui a seleção', () => {
    const r = insertEmojiAtSelection('ola mundo', '😀', 0, 3);

    expect(r.text).toBe('😀 mundo');
    expect(r.caret).toBe(2);
  });

  it('substitui seleção no meio', () => {
    const r = insertEmojiAtSelection('abcdef', '👍', 2, 4);

    expect(r.text).toBe('ab👍ef');
    expect(r.caret).toBe(4);
  });

  it('preserva acentos e o texto ao redor', () => {
    const r = insertEmojiAtSelection('ação concluída', '✅', 5, 5);

    expect(r.text).toBe('ação ✅concluída');
  });

  it('trata emoji composto sem cortar a sequência', () => {
    // 👨‍👩‍👧 são 8 unidades de código. O cursor tem que ir para depois de
    // TODAS elas; contar 1 ou 3 deixaria pedaços do ZWJ para trás.
    const family = '👨‍👩‍👧';
    const r = insertEmojiAtSelection('ab', family, 1, 1);

    expect(r.text).toBe(`a${family}b`);
    expect(r.caret).toBe(1 + family.length);
    expect(family.length).toBe(8);
  });

  it('prende índices fora do intervalo ao tamanho do texto', () => {
    // Rascunho limpo enquanto o seletor está aberto: start/end ficam
    // apontando para um texto que não existe mais.
    const r = insertEmojiAtSelection('oi', '😀', 99, 120);

    expect(r.text).toBe('oi😀');
    expect(r.caret).toBe(4);
  });

  it('prende índices negativos em zero', () => {
    const r = insertEmojiAtSelection('oi', '😀', -5, -1);

    expect(r.text).toBe('😀oi');
    expect(r.caret).toBe(2);
  });

  it('corrige seleção invertida (end < start)', () => {
    const r = insertEmojiAtSelection('abcdef', '😀', 4, 2);

    expect(r.text).toBe('abcd😀ef');
    expect(r.caret).toBe(6);
  });
});
