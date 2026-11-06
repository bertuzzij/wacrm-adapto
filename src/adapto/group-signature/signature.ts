// ============================================================
// Assinatura de mensagem em grupo.
//
// O WhatsApp não tem campo de autor: numa conversa de grupo, toda
// mensagem sai do NÚMERO que enviou, não de uma pessoa. Com vários
// atendentes usando o mesmo número pelo CRM, o cliente do outro lado vê
// só "a empresa" — nunca quem escreveu.
//
// Isso não é limitação do código; é do protocolo. A saída usada no mercado
// é escrever o nome no próprio texto, como negrito. Aqui a decisão é
// deliberada:
//
//   - SÓ em grupo. Numa conversa individual o cliente já sabe com quem
//     fala, e um prefixo ali é ruído.
//   - O nome vem do `sender_id` da mensagem, não de quem está logado —
//     assim um reenvio por outro agente não herda o nome errado.
//   - O texto guardado no CRM é o ORIGINAL; a assinatura é aplicada só no
//     envio. Sem isso, cada nova mensagem carregaria o prefixo da anterior
//     e a thread viraria uma escada.
// ============================================================

/** Como o nome é escrito no texto enviado. */
export type SignatureStyle = 'bold' | 'brackets';

export interface SignatureOptions {
  /** Nome do atendente que enviou. Vazio/ausente = sem assinatura. */
  agentName?: string | null;
  /** Desligado pela conta: devolve o texto intacto. */
  enabled?: boolean;
  /** `bold` = `*Nome:*`, `brackets` = `[Nome]`. */
  style?: SignatureStyle;
}

/**
 * Aplica a assinatura na frente do texto.
 *
 * Idempotente por construção: se o texto já começa com a assinatura deste
 * mesmo nome, nada é adicionado. Isso evita `*Ana:* *Ana:* olá` quando o
 * composer reenvia um rascunho ou um retry do WAHA repete o envio.
 */
export function applyGroupSignature(
  text: string,
  options: SignatureOptions = {}
): string {
  const { agentName, enabled = true, style = 'bold' } = options;

  if (!enabled) return text;

  const name = (agentName ?? '').trim();
  if (!name) return text;

  const body = text.replace(/^\s+/, '');
  if (!body) return text;

  const prefix =
    style === 'brackets' ? `[${name}]` : `*${name}:*`;

  // Já assinada por este nome: não duplica.
  if (body.startsWith(prefix)) return body;

  return `${prefix} ${body}`;
}

/**
 * Remove a assinatura do início do texto.
 *
 * Usado no preview da lista de conversas e nos toasts, onde o prefixo
 * ocupa espaço sem informar nada — quem lê a prévia já sabe que é o time.
 */
export function stripGroupSignature(text: string): string {
  return text
    .replace(/^\*[^*\n]{1,60}:\*\s?/, '')
    .replace(/^\[[^\]\n]{1,60}\]\s?/, '');
}
