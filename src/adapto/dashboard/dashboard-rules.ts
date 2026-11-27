// ============================================================
// Regras de exibição do painel de gestão para adaptações da conta.
//
// Duas decisões por conta alteram o que o painel deve mostrar e para
// onde seus atalhos devem levar:
//
//   - `enforceMessagingWindow`: quando desligada (modo WAHA), não
//     existe janela gratuita de 24h da Meta — esconder o card e o
//     selo na fila evita mostrar um alerta que não se aplica.
//   - `waitingOnlyUnread`: quando ligada, "Aguardando resposta" conta
//     só conversas não lidas; clicar no card leva ao filtro `unread`
//     da inbox em vez de `waiting`, mantendo painel e inbox coerentes.
//
// Módulo puro, testável sem React e sem rede.
// ============================================================

/** O card "Janelas de resposta fechando" deve aparecer no painel? */
export function showWindowClosingCard(enforceMessagingWindow?: boolean): boolean {
  // Ausente = payload anterior à migração 075; preserva comportamento padrão.
  return enforceMessagingWindow !== false;
}

/** O selo "Janela fecha em …" deve aparecer nos itens da fila de respostas? */
export function shouldShowQueueWindowBadge(
  enforceMessagingWindow: boolean | undefined,
  windowLeftMinutes: number,
  warningThresholdMinutes: number,
): boolean {
  if (!showWindowClosingCard(enforceMessagingWindow)) return false;
  return windowLeftMinutes > 0 && windowLeftMinutes <= warningThresholdMinutes;
}

/** Rota da inbox ao clicar em "Aguardando resposta" / "Abrir caixa de entrada". */
export function waitingQueueHref(waitingOnlyUnread?: boolean): string {
  return waitingOnlyUnread ? '/inbox?filter=unread' : '/inbox?filter=waiting';
}
