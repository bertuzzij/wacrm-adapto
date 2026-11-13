// ============================================================
// Formatação do WhatsApp no composer.
//
// Duas funções:
//
//   1. `wrapSelection` — envolve a seleção (ou a palavra sob o cursor) com
//      o marcador, exatamente como os botões de formatação do WhatsApp Web.
//      É o que os atalhos e a barra chamam.
//
//   2. `wrapKeyShortcut` — interpreta Ctrl+B / Ctrl+I / Ctrl+Shift+X no
//      textarea, devolvendo o novo texto e o cursor. `preventDefault` é
//      responsabilidade do chamador.
//
// Módulo puro, sem React: opera sobre (texto, seleção) e devolve
// (texto, seleção). O composer só aplica no estado.
// ============================================================

export interface TextSelection {
  text: string;
  start: number;
  end: number;
}

export interface TextEditResult {
  text: string;
  /** Nova posição do cursor: após o conteúdo, dentro dos marcadores. */
  caret: number;
  /** Comprimento da seleção anterior, quando sobrevive ao formato. */
  selectedLength: number;
  /** Falso quando nada mudou (ex.: Ctrl+B sem seleção e sem palavra). */
  changed: boolean;
}

/** Delimitadores por tipo, na ordem que os atalhos usam. */
export const FORMATTERS = {
  bold: { token: '*', label: 'Negrito' },
  italic: { token: '_', label: 'Itálico' },
  strike: { token: '~', label: 'Riscado' },
  code: { token: '`', label: 'Monoespaçado' },
} as const;

export type FormatterKind = keyof typeof FORMATTERS;

function isWordChar(char: string | undefined): boolean {
  if (char === undefined) return false;
  return /[\p{L}\p{N}]/u.test(char);
}

/**
 * Expande a seleção até cobrir a palavra sob o cursor, quando não há
 * seleção explícita. É o que o WhatsApp Web faz: Ctrl+B sem seleção
 * aplica na palavra inteira onde o cursor está.
 */
function expandToWord(text: string, caret: number): { start: number; end: number } {
  if (caret >= text.length || isWordChar(text[caret])) {
    // Cursor sobre/em cima de uma palavra: anda para trás e para frente.
    let start = caret;
    while (start > 0 && isWordChar(text[start - 1])) start--;
    let end = caret;
    while (end < text.length && isWordChar(text[end])) end++;
    if (end > start) return { start, end };
  }
  // Sem palavra: insere os marcadores vazios no cursor.
  return { start: caret, end: caret };
}

/**
 * Envolve a seleção com o marcador, alternando: se a seleção JÁ está
 * envolvida por aquele marcador, remove (toggle) — como qualquer editor.
 */
export function wrapSelection(
  selection: TextSelection,
  kind: FormatterKind,
): TextEditResult {
  const { token } = FORMATTERS[kind];
  const { text } = selection;
  let { start, end } = selection;

  // Normaliza seleção vazia para a palavra sob o cursor.
  if (start === end) {
    const word = expandToWord(text, start);
    start = word.start;
    end = word.end;
  }

  // 1. Toggle de REMOÇÃO: a seleção já está envolvida?
  if (start >= token.length && end + token.length <= text.length) {
    const before = text.slice(start - token.length, start);
    const after = text.slice(end, end + token.length);
    if (before === token && after === token) {
      const inner = text.slice(start, end);
      return {
        text: text.slice(0, start - token.length) + inner + text.slice(end + token.length),
        caret: start - token.length + inner.length,
        selectedLength: inner.length,
        changed: true,
      };
    }
  }

  // 2. Toggle de remoção com a seleção incluindo os marcadores.
  const selected = text.slice(start, end);
  if (
    selected.length >= token.length * 2 &&
    selected.startsWith(token) &&
    selected.endsWith(token) &&
    selected.length > token.length * 2
  ) {
    const inner = selected.slice(token.length, selected.length - token.length);
    return {
      text: text.slice(0, start) + inner + text.slice(end),
      caret: start + inner.length,
      selectedLength: inner.length,
      changed: true,
    };
  }

  // 3. Aplica o marcador.
  const wrapped = text.slice(0, start) + token + selected + token + text.slice(end);
  const caret = start + token.length + selected.length;
  return {
    text: wrapped,
    caret,
    selectedLength: selected.length,
    changed: true,
  };
}

// ============================================================
// Lista de itens (o "- " do WhatsApp).
//
// A lista do WhatsApp NÃO é formatação no fio: `- item` viaja como texto
// puro e é o app do celular que desenha o marcador. Diferente de *negrito*,
// que viaja com o marcador dentro da mensagem.
//
// Por isso aqui o trabalho é só ajudar a DIGITAR:
//
//   - `startListItem` insere `- ` no início da linha do cursor (ou nas
//     linhas da seleção, transformando cada uma em item);
//   - `continueListOnEnter` decide o que o Enter faz dentro de uma lista:
//     continuar com o próximo `- ` ou encerrar a lista (linha vazia).
//
// ============================================================

/** Prefixo do item de lista, como o WhatsApp espera. */
export const LIST_PREFIX = '- ';

/** A linha é um item de lista? */
export function isListItem(line: string): boolean {
  return /^- /.test(line);
}

/** A linha está vazia (só espaços)? Lista termina nela. */
function isBlank(line: string): boolean {
  return line.trim() === '';
}

/** Início da linha que contém a posição. */
function lineStart(text: string, position: number): number {
  const nl = text.lastIndexOf('\n', position - 1);
  return nl === -1 ? 0 : nl + 1;
}

/** Conteúdo da linha que contém a posição (sem o \n). */
function lineOf(text: string, position: number): string {
  const start = lineStart(text, position);
  const nl = text.indexOf('\n', start);
  return text.slice(start, nl === -1 ? text.length : nl);
}

export interface ListInsertResult {
  text: string;
  caret: number;
  changed: boolean;
}

/**
 * Transforma a(s) linha(s) da seleção em itens de lista.
 *
 * Com seleção multi-linha, cada linha vira um item (linhas já marcadas
 * não recebem prefixo duplicado). Com cursor sem seleção, só a linha do
 * cursor é afetada. Toggle: todas as linhas já sendo itens remove o
 * prefixo de todas.
 */
export function startListItem(selection: TextSelection): ListInsertResult {
  const { text } = selection;
  let { start, end } = selection;

  const selStart = lineStart(text, start);
  const endLine = lineOf(text, end);
  const selEnd = end + (endLine.length - lineOf(text, end).length);

  // Linhas envolvidas: da linha do início da seleção até a do fim.
  const blockStart = lineStart(text, start);
  const blockText = text.slice(blockStart, Math.max(selEnd, end));
  const lines = blockText.split('\n');

  const allItems = lines.every((l) => isListItem(l) || isBlank(l));
  const anyItem = lines.some((l) => isListItem(l));

  const transformed = lines.map((line) => {
    if (isBlank(line)) return line;
    if (allItems && anyItem) return line.slice(LIST_PREFIX.length);
    if (isListItem(line)) return line;
    return LIST_PREFIX + line;
  });

  const replaced = transformed.join('\n');
  const changedText =
    text.slice(0, blockStart) + replaced + text.slice(blockStart + blockText.length);

  const delta = replaced.length - blockText.length;
  return {
    text: changedText,
    // Cursor volta ao fim do conteúdo da linha em que a seleção terminava.
    caret: end + delta,
    changed: true,
  };
}

/**
 * O que o Enter faz dentro de uma lista.
 *
 * Devolve `null` quando o Enter deve se comportar normalmente (quebra de
 * linha simples — inclusive fora de lista).
 *
 * Casos:
 *   - linha vazia na lista → sai da lista (só a quebra, sem novo item);
 *   - linha de item com conteúdo → continua a lista com `- ` pronto.
 */
export function continueListOnEnter(
  text: string,
  caret: number,
): ListInsertResult | null {
  const line = lineOf(text, caret);
  if (!isListItem(line)) return null;

  const content = line.slice(LIST_PREFIX.length).trim();

  // Item vazio: Enter encerra a lista — remove o `- ` solto e quebra a
  // linha limpa. É o que o WhatsApp faz: Enter num item vazio sai.
  if (content === '') {
    const lineStartPos = lineStart(text, caret);
    const before = text.slice(0, lineStartPos);
    const after = text.slice(lineStartPos + line.length);
    return {
      text: `${before}${after}`,
      caret: lineStartPos,
      changed: true,
    };
  }

  // Item com conteúdo: continua a lista.
  const insert = `\n${LIST_PREFIX}`;
  return {
    text: text.slice(0, caret) + insert + text.slice(caret),
    caret: caret + insert.length,
    changed: true,
  };
}

/** Atalho de teclado → formatter. `null` quando a tecla não é atalho. */
export function shortcutFor(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): FormatterKind | null {
  if (!(e.ctrlKey || e.metaKey)) return null;

  switch (e.key.toLowerCase()) {
    case 'b':
      return e.shiftKey ? null : 'bold';
    case 'i':
      return e.shiftKey ? null : 'italic';
    case 'x':
      return e.shiftKey ? 'strike' : null;
    case 'e':
      return 'code';
    default:
      return null;
  }
}

/**
 * Aplica um formatter a partir de um evento de teclado no textarea.
 * O chamador faz `preventDefault()` quando o retorno tem `changed`.
 */
export function wrapKeyShortcut(selection: TextSelection, e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): TextEditResult {
  const kind = shortcutFor(e);
  if (!kind) return { ...selection, caret: selection.start, selectedLength: selection.end - selection.start, changed: false };
  return wrapSelection(selection, kind);
}
