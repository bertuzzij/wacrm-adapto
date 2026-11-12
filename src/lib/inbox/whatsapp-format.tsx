// ============================================================
// Formatação de texto do WhatsApp, renderizada como React.
//
// WhatsApp aceita, no fio:
//
//   *negrito*          → bold
//   _itálico_          → italic
//   ~riscado~          → strike
//   ```monoespaçado``` → code (triplo crase)
//   `inline`           → código (crase simples)
//   "> citação"        → blockquote (no início da linha)
//   "```" isolado      → bloco de código
//
// O texto chega cru do WhatsApp (com os marcadores) — o banco guarda o que
// o cliente enviou. Renderizar os marcadores como estilos é o que faz a
// conversa parecer com o que o cliente vê no celular.
//
// ## Por que um parser próprio e não regex encadeado
//
// Os marcadores interagem: `*_a_*` é negrito contendo itálico. Um parser
// de um passo lê o texto uma vez, do início ao fim, e o delimitador de
// abertura/fechamento fica inequívoco — regex global de substituição
// tende a casar o fechamento errado quando há marcadores aninhados ou
// múltiplas ocorrências na mesma linha.
//
// ## Segurança
//
// NADA vira HTML. O parser devolve nós React com estilos, então o
// `dangerouslySetInnerHTML` fica fora de questão e o texto do cliente não
// pode injetar nada. Links continuam sendo resolvidos pelo `LinkifyText`
// existente, que roda por cima dos trechos de texto puro.
// ============================================================

import { createElement, type ReactNode } from 'react';
import { LinkifyText } from '@/lib/inbox/linkify-text';

/** Marcadores suportados, com o estilo que cada um vira. */
const MARKERS = [
  { token: '```', kind: 'code-block' },
  { token: '*', kind: 'bold' },
  { token: '_', kind: 'italic' },
  { token: '~', kind: 'strike' },
  { token: '`', kind: 'code' },
] as const;

type MarkerKind = (typeof MARKERS)[number]['kind'];

interface FormattedSegment {
  text: string;
  kind: MarkerKind | 'plain' | 'quote';
}

/** Um trecho com os marcadores já resolvidos, pronto para o linkify. */
interface TextChunk {
  kind: 'text' | 'quote';
  /** Delimitador de fechamento ainda aberto, para o par correto. */
  open: MarkerKind | null;
  segments: FormattedSegment[];
}

/** Confirma que a posição abre um marcador e devolve o tipo. */
function markerAt(text: string, index: number): MarkerKind | null {
  for (const { token, kind } of MARKERS) {
    if (text.startsWith(token, index)) return kind;
  }
  return null;
}

/**
 * O WhatsApp só formata quando o delimitador tem fronteira válida.
 *
 * Regra prática observada no app:
 *
 *   ABERTURA: o caractere seguinte não pode ser espaço — `* mundo` não
 *   abre — e o caractere ANTERIOR não pode ser letra (senão `pro*duto_*`
 *   abriria no meio de uma palavra).
 *
 *   FECHAMENTO: o caractere anterior não pode ser espaço — `*a *` não
 *   fecha — e o seguinte não pode ser letra (`*a*b` não fecha no meio).
 *   Fim da linha fecha: `*mundo*` no fim é o caso mais comum de todos.
 *
 * Sem isso, "5 > 3" e e-mails com `_` ganhariam estilos aleatórios.
 */
function canOpenAt(text: string, index: number, token: string): boolean {
  const after = text[index + token.length];
  if (after === undefined) return false; // abrir no fim da linha é literal
  if (/\s/.test(after)) return false;

  const before = text[index - 1];
  if (before !== undefined && /[\p{L}\p{N}_]/u.test(before)) return false;

  return true;
}

function canCloseAt(text: string, index: number, token: string): boolean {
  const before = text[index - 1];
  if (before === undefined) return false;
  if (/\s/.test(before)) return false;

  const after = text[index + token.length];
  if (after !== undefined && /[\p{L}\p{N}]/u.test(after)) return false;

  return true;
}

/**
 * Parseia o corpo de uma linha (sem o `> ` de citação), resolvendo pares
 * de delimitadores. O que sobrar sem par fica texto literal — WhatsApp
 * faz o mesmo: `*negrito` solto não vira nada.
 */
function parseSegments(line: string): FormattedSegment[] {
  const segments: FormattedSegment[] = [];
  const open: Array<{ kind: MarkerKind; token: string }> = [];
  let plain = '';
  let i = 0;

  const flush = () => {
    if (!plain) return;
    segments.push({ text: plain, kind: open.at(-1)?.kind ?? 'plain' });
    plain = '';
  };

  while (i < line.length) {
    const kind = markerAt(line, i);

    if (kind) {
      const token = MARKERS.find((m) => m.kind === kind)!.token;
      const top = open.at(-1);

      // Delimitador precisa de fronteira válida para abrir.
      const canOpen =
        // ``` é exceção: o bloco de código abre colado no conteúdo.
        token === '```' || canOpenAt(line, i, token);

      if (top && top.kind === kind) {
        // Possível fechamento do marcador aberto — precisa de fronteira.
        if (canCloseAt(line, i, token)) {
          flush();
          open.pop();
          i += token.length;
          continue;
        }
        // Sem fronteira: é literal (ex.: `*a*b`).
        plain += token;
        i += token.length;
        continue;
      }

      if (!canOpen) {
        plain += token;
        i += token.length;
        continue;
      }

      if (top && top.token.length < token.length) {
        // Um marcador mais curto não abre dentro de um mais longo do mesmo
        // início (ex.: ``` dentro de ```). Trata como literal.
        plain += token;
        i += token.length;
        continue;
      }

      // Mesmo estilo aninhado do mesmo tipo é literal (WhatsApp não aninha
      // `*a*b` como negrito duplo) — já coberto acima pelo fechamento; um
      // segundo abre do mesmo tipo dentro do primeiro é literal.
      if (top && top.kind === kind) {
        plain += token;
        i += token.length;
        continue;
      }

      flush();
      open.push({ kind, token });
      i += token.length;
      continue;
    }

    plain += line[i];
    i += 1;
  }

  flush();

  // Delimitador aberto sem par no fim da linha: tudo que está "dentro" dele
  // volta a ser literal, COM o marcador visível. É o comportamento do
  // WhatsApp para `*a combinar` solto — a formatação nunca atravessa o fim
  // da linha sem fechamento.
  //
  // Reescrever os segmentos em vez de emitir o marcador no fim: o texto
  // precisa voltar a plano na ordem original, e o marcador fica no ponto
  // onde estava.
  if (open.length > 0) {
    const tokensByKind = new Map<MarkerKind, string>(
      MARKERS.map((m) => [m.kind, m.token]),
    );
    let literal = '';
    let firstToken = '';

    for (const segment of segments) {
      // Só segmentos vindos de marcadores têm token; 'quote' nunca entra
      // aqui (o parser de segmentos roda por linha, fora da citação).
      if (segment.kind === 'plain' || segment.kind === 'quote') {
        literal += segment.text;
      } else {
        const token = tokensByKind.get(segment.kind) ?? '';
        // O token de abertura de cada trecho formatado volta na sua posição.
        if (!firstToken) firstToken = token;
        literal += token + segment.text;
      }
    }
    // E o token do delimitador que ficou aberto por último.
    const lastToken = tokensByKind.get(open.at(-1)!.kind) ?? '';
    return [{ text: literal + lastToken, kind: 'plain' }];
  }

  // Delimitador sem par fica como texto — igual ao WhatsApp.
  return segments;
}

/** Renderiza um segmento com o estilo do marcador. */
function styleFor(kind: FormattedSegment['kind']): React.CSSProperties | undefined {
  switch (kind) {
    case 'bold':
      return { fontWeight: 700 };
    case 'italic':
      return { fontStyle: 'italic' };
    case 'strike':
      return { textDecoration: 'line-through' };
    default:
      return undefined;
  }
}

/**
 * Texto de mensagem formatado como o WhatsApp renderiza.
 *
 * Uso: no lugar de `<LinkifyText …>` direto — os links continuam
 * funcionando porque cada trecho de texto puro passa pelo `LinkifyText`.
 */
export function WhatsAppText({
  text,
  isAgent,
}: {
  text: string;
  isAgent: boolean;
}): ReactNode {
  const lines = text.split('\n');
  const out: ReactNode[] = [];

  lines.forEach((line, lineIndex) => {
    // Citação: `> ` no início da linha (WhatsApp permite com ou sem espaço).
    const quoteMatch = /^>\s?/.exec(line);

    const chunks: Array<{ kind: 'text' | 'quote'; content: string }> = [];
    let cursor = line;
    let quoteRemainder = '';

    if (quoteMatch) {
      chunks.push({ kind: 'quote', content: line.slice(quoteMatch[0].length) });
      quoteRemainder = line.slice(quoteMatch[0].length);
    } else {
      chunks.push({ kind: 'text', content: line });
    }

    chunks.forEach((chunk, chunkIndex) => {
      const segments =
        chunk.kind === 'quote'
          ? [{ text: chunk.content, kind: 'quote' as const }]
          : parseSegments(chunk.content);

      segments.forEach((segment, segmentIndex) => {
        const key = `${lineIndex}-${chunkIndex}-${segmentIndex}`;

        if (segment.kind === 'quote') {
          out.push(
            createElement(
              'span',
              {
                key,
                style: {
                  display: 'inline-block',
                  borderLeft: '3px solid currentColor',
                  paddingLeft: '0.5rem',
                  opacity: 0.85,
                  width: '100%',
                },
              },
              createElement(LinkifyText, { text: segment.text, isAgent }),
            ),
          );
          return;
        }

        const style = styleFor(segment.kind);
        if (!style && segment.kind !== 'code' && segment.kind !== 'code-block') {
          out.push(
            createElement(LinkifyText, {
              key,
              text: segment.text,
              isAgent,
            }),
          );
          return;
        }

        out.push(
          createElement(
            'span',
            {
              key,
              style:
                segment.kind === 'code' || segment.kind === 'code-block'
                  ? {
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: '0.85em',
                      background: 'rgba(128,128,128,0.18)',
                      padding: '0.1em 0.3em',
                      borderRadius: '4px',
                    }
                  : style,
            },
            segment.text,
          ),
        );
      });
    });

    // A quebra de linha entre linhas: o pai usa `whitespace-pre-wrap`, que
    // preserva o `\n` do texto original. Como o parser consome o texto por
    // linha, a quebra precisa ser reintroduzida entre elas.
    if (lineIndex < lines.length - 1) {
      out.push(createElement('span', { key: `br-${lineIndex}` }, '\n'));
    }
  });

  return createElement('span', null, out);
}
