// ============================================================
// Inserir um emoji na posição do cursor.
//
// O caminho fácil seria `setText(text + emoji)`, que joga o emoji no fim.
// O WhatsApp insere onde o cursor está — e quem está no meio de uma frase
// espera exatamente isso. Este módulo é puro de propósito: dá para testar
// cursor, seleção e emoji composto sem navegador.
//
// A armadilha dos emojis: um único emoji pode ocupar várias unidades de
// código JS (👨‍👩‍👧 são 8, por causa dos ZWJ). Nada aqui conta emoji por
// `length`; o cursor é medido na mesma unidade que o `<textarea>` usa,
// então repassar os índices crus é o comportamento correto.
// ============================================================

export interface EmojiInsertion {
  /** Texto resultante. */
  text: string;
  /** Posição do cursor depois da inserção, para o `<textarea>` receber foco ali. */
  caret: number;
}

/**
 * Insere `emoji` em `text`, substituindo a seleção [start, end) e deixando
 * o cursor logo depois do emoji.
 *
 * Índices fora do intervalo são presos ao tamanho do texto — um seletor
 * que abre enquanto o texto muda (undo, limpeza de rascunho) não pode
 * gerar posição inválida.
 */
export function insertEmojiAtSelection(
  text: string,
  emoji: string,
  start: number,
  end: number
): EmojiInsertion {
  const len = text.length;
  const from = Math.min(Math.max(0, start), len);
  const to = Math.min(Math.max(from, end), len);

  const next = text.slice(0, from) + emoji + text.slice(to);
  return { text: next, caret: from + emoji.length };
}
