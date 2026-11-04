// ============================================================
// Como o indicador de não-lidas aparece.
//
// Contexto: chegou o relato "na caixa de entrada não sinalizou que havia
// uma mensagem nova". Duas causas, ambas de apresentação:
//
//   1. O ponto no menu lateral tinha `!isActive` na condição, então
//      desaparecia exatamente quando o usuário estava no inbox — que é
//      onde ele olha para o menu.
//   2. Um ponto não diz quantas conversas esperam. Mesmo visível, é mais
//      fraco que um número.
//
// A regra agora: havendo qualquer conversa com mensagem não lida, o
// indicador aparece sempre (inclusive na seção ativa) e mostra a
// contagem. A contagem é de CONVERSAS, não de mensagens — é o que
// `useTotalUnread` já mede e o que o badge de cada linha soma.
// ============================================================

/**
 * Texto do badge numérico.
 *
 * Devolve `null` quando não há nada a mostrar, para o chamador não
 * precisar comparar com zero (e para o tipo deixar claro que "sem badge"
 * é um estado distinto de "badge vazio").
 *
 * Acima de 9 vira "9+" pela mesma razão do badge de notificações: manter
 * o cabeçalho com largura estável. Um "128" empurraria o título da página
 * e quebraria o layout no mobile.
 */
export function formatUnreadBadge(total: number): string | null {
  if (!Number.isFinite(total) || total <= 0) return null
  return total > 9 ? '9+' : String(Math.floor(total))
}

/**
 * Se o indicador deve ser desenhado.
 *
 * `isActiveSection` existe por causa da regressão: a versão anterior
 * escondia o ponto quando a seção estava ativa, o que fazia o aviso sumir
 * no instante em que o usuário navegava para o inbox para procurá-lo.
 * A não-lida não deixa de existir porque a tela está aberta — quem abre o
 * inbox ainda precisa ver quais conversas esperam.
 */
export function shouldShowUnreadIndicator({
  total,
}: {
  total: number
  isActiveSection: boolean
}): boolean {
  return formatUnreadBadge(total) !== null
}

/** Destino do clique no sino: a lista já filtrada por não-lidas. */
export function bellHref(): string {
  return '/inbox?filter=unread'
}
