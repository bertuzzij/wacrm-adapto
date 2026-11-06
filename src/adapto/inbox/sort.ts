// ============================================================
// Ordenação da lista de conversas.
//
// A regra é simples de enunciar e fácil de errar na implementação:
//
//   1. fixadas primeiro, da fixada mais recentemente para a mais antiga
//   2. depois as demais, da mensagem mais recente para a mais antiga
//
// Dois detalhes que justificam um módulo próprio (e testes):
//
//   - `pinned_at` é comparado como DATA, não como string. ISO-8601 com `Z`
//     ordena certo lexicograficamente, mas um timestamp sem timezone vindo
//     do banco NÃO ordena — e o bug apareceria só com fusos diferentes.
//   - conversa sem `last_message_at` (recém-criada, sem mensagem) precisa de
//     um lugar definido em vez de virar `NaN` na comparação. Vai para o fim
//     das não-fixadas.
// ============================================================

export interface SortableConversation {
  id: string;
  pinned_at?: string | null;
  last_message_at?: string | null;
}

/** Milissegundos de um timestamp, ou null quando ausente/inválido. */
function timeOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Comparador para a lista da inbox.
 *
 * Devolve negativo quando `a` vem antes de `b`.
 */
export function compareConversations(
  a: SortableConversation,
  b: SortableConversation
): number {
  const aPinned = timeOf(a.pinned_at);
  const bPinned = timeOf(b.pinned_at);

  // Fixadas antes de não-fixadas, sempre.
  if (aPinned !== null && bPinned === null) return -1;
  if (aPinned === null && bPinned !== null) return 1;

  // Duas fixadas: a fixada mais recentemente primeiro (a última ação do
  // usuário é a que ele quer ver no topo).
  if (aPinned !== null && bPinned !== null && aPinned !== bPinned) {
    return bPinned - aPinned;
  }

  // Mesmo grupo: ordem por última mensagem, mais recente primeiro.
  const aLast = timeOf(a.last_message_at);
  const bLast = timeOf(b.last_message_at);

  // Sem mensagem vai para o fim, não para o topo: uma conversa criada mas
  // ainda silenciosa não deve empurrar quem está conversando agora.
  if (aLast === null && bLast === null) return 0;
  if (aLast === null) return 1;
  if (bLast === null) return -1;

  return bLast - aLast;
}

/** `true` quando a conversa está fixada. */
export function isPinned(conversation: {
  pinned_at?: string | null;
}): boolean {
  return timeOf(conversation.pinned_at) !== null;
}

/**
 * Aplica a ordenação sem mutar o array recebido.
 *
 * `filter`/`map` no chamador devolvem arrays novos, mas ordenar no lugar um
 * array que veio do estado do React é a origem clássica de "a lista mudou
 * sozinha" — a referência é a mesma e o React não vê a mudança.
 */
export function sortConversations<T extends SortableConversation>(
  conversations: readonly T[]
): T[] {
  return [...conversations].sort(compareConversations);
}
