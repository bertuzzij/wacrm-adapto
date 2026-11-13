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
