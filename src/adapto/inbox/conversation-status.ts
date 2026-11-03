// ============================================================
// O que a bolinha ao lado da conversa significa.
//
// Havia uma confusão real aqui, relatada como "a mensagem já foi lida mas
// a bolinha verde continua aparecendo". A bolinha NÃO é o indicador de não
// lido: é o STATUS da conversa. O "não lido" é o contador numérico, que só
// existe enquanto unread_count > 0.
//
// O problema é que `open` é o estado da esmagadora maioria das conversas,
// então um ponto verde em todas elas:
//
//   1. não informa nada (se todo mundo tem, ninguém tem);
//   2. imita visualmente o marcador de "mensagem nova", fazendo uma
//      conversa já lida parecer não lida.
//
// A decisão: ponto só para estados fora do normal. `open` não desenha
// nada; `pending` e `closed` desenham. Assim a bolinha significa "esta
// conversa precisa de atenção", que é informação de verdade.
// ============================================================

export type ConversationStatusLike = 'open' | 'pending' | 'closed'

/**
 * Se o status merece um ponto colorido na lista.
 *
 * `open` é o normal e fica sem marca. Os demais fogem do padrão e por
 * isso aparecem.
 */
export function shouldShowStatusDot(status: ConversationStatusLike): boolean {
  return status !== 'open'
}

/**
 * Cor do ponto, por status.
 *
 * `open` nunca é desenhado (ver acima), mas o mapa continua completo para
 * quem precisar da cor do status em outro contexto — por exemplo um
 * seletor que mostra as três opções.
 */
export const STATUS_DOT_COLORS: Record<ConversationStatusLike, string> = {
  open: 'bg-primary',
  pending: 'bg-amber-500',
  closed: 'bg-muted-foreground',
}

/**
 * Rótulo do status para leitores de tela e tooltip.
 *
 * Usado como chave de tradução (`Inbox.conversationList.status.<valor>`),
 * então precisa continuar sendo o valor cru em inglês — traduzir aqui
 * quebraria a busca da chave.
 */
export function statusLabelKey(status: ConversationStatusLike): string {
  return `status.${status}`
}
