import { describe, expect, it } from 'vitest';
import {
  startListItem,
  continueListOnEnter,
  isListItem,
  LIST_PREFIX,
} from './editing';

const sel = (text: string, start: number, end: number = start) => ({
  text,
  start,
  end,
});

describe('isListItem', () => {
  it('reconhece "- item"', () => {
    expect(isListItem('- café')).toBe(true);
  });

  it('não reconhece hífen sem espaço', () => {
    // "-café" é palavra com hífen, não lista.
    expect(isListItem('-café')).toBe(false);
  });

  it('não reconhece hífen no meio da linha', () => {
    expect(isListItem('produto - usado')).toBe(false);
  });
});

describe('startListItem', () => {
  it('transforma a linha do cursor em item', () => {
    const r = startListItem(sel('primeira linha\nsegunda linha', 20));
    expect(r.text).toBe('primeira linha\n- segunda linha');
  });

  it('toggle: linha já em item volta ao texto', () => {
    const r = startListItem(sel('- item já feito', 10));
    expect(r.text).toBe('item já feito');
  });

  it('seleção multi-linha transforma cada linha em item', () => {
    const text = 'a\nb\nc';
    // Seleciona da linha 1 à 3.
    const r = startListItem(sel(text, 0, text.length));
    expect(r.text).toBe('- a\n- b\n- c');
  });

  it('toggle multi-linha remove de todas', () => {
    const r = startListItem(sel('- a\n- b\n- c', 0, 11));
    expect(r.text).toBe('a\nb\nc');
  });

  it('linhas vazias dentro da seleção não recebem prefixo', () => {
    const r = startListItem(sel('a\n\nc', 0, 4));
    expect(r.text).toBe('- a\n\n- c');
  });

  it('linha já em item num bloco misto não duplica prefixo', () => {
    const text = '- já é item\nnovo texto';
    const r = startListItem(sel(text, 0, text.length));
    expect(r.text).toBe('- já é item\n- novo texto');
  });
});

describe('continueListOnEnter', () => {
  it('item com conteúdo: Enter continua a lista', () => {
    const r = continueListOnEnter('- primeiro item', 15);
    expect(r?.text).toBe('- primeiro item\n- ');
    // 15 (linha) + 3 (\n + "- ") = 18.
    expect(r?.caret).toBe(18);
  });

  it('item vazio: Enter ENCERRA a lista', () => {
    // "- " solto no fim: Enter remove o prefixo e sai da lista.
    const r = continueListOnEnter('- primeiro\n- ', 12);
    expect(r?.text).toBe('- primeiro\n');
    expect(r?.changed).toBe(true);
  });

  it('fora de lista: Enter normal (null)', () => {
    expect(continueListOnEnter('texto comum', 11)).toBeNull();
  });

  it('linha comum dentro de texto longo não vira lista', () => {
    const text = 'olá\nlinha do meio\nfim';
    // Cursor no meio da linha 2.
    expect(continueListOnEnter(text, 8)).toBeNull();
  });

  it('- no meio de texto não é lista (precisa ser no início da linha)', () => {
    expect(continueListOnEnter('produto - usado', 15)).toBeNull();
  });

  it('item com só espaços depois do prefixo também encerra', () => {
    const r = continueListOnEnter('-    ', 5);
    expect(r?.text).toBe('');
  });
});

describe('integração composer — sequência de digitação', () => {
  it('digitar lista: 3 Enter seguidos mantêm os itens', () => {
    let text = '- item 1';
    // Enter após item 1.
    let r = continueListOnEnter(text, text.length);
    text = r!.text; // "- item 1\n- "
    // Digita "item 2" (simula o usuário; o caret anda).
    text += 'item 2';
    // Enter após item 2.
    r = continueListOnEnter(text, text.length);
    text = r!.text;
    text += 'item 3';

    expect(text).toBe('- item 1\n- item 2\n- item 3');
  });

  it('digitar e encerrar com Enter em item vazio', () => {
    let text = '- item 1\n- ';
    const r = continueListOnEnter(text, text.length);
    // Sai da lista sem um item órfão.
    expect(r?.text).toBe('- item 1\n');
  });

  it('a lista viaja como TEXTO — o preview/bolha mostram o hífen', () => {
    // Documentação do contrato: a lista NÃO é marcador de formatação.
    // O texto final enviado é exatamente o que foi digitado.
    const text = '- item 1\n- item 2';
    expect(text.startsWith(LIST_PREFIX)).toBe(true);
    expect(text).toContain('- item 2');
  });
});
