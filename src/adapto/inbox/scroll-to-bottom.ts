// ============================================================
// Botão de rolar até o final da conversa no inbox.
//
// O problema real: ao abrir uma conversa longa (ou com mídia que
// termina de carregar depois do primeiro render, ou depois de rolar
// para cima para ler o histórico), o atendente precisa rolar tudo na
// mão até a última mensagem.
//
// Este módulo mantém a regra de visibilidade e a ação de rolagem puras
// para testar sem DOM real:
//
//   - distância até o fundo nunca é negativa (cobre bounce elástico
//     do iOS/Safari, onde scrollTop + clientHeight > scrollHeight);
//   - o botão só aparece quando o usuário está afastado do fundo além
//     de um limiar folgado, evitando piscar por arredondamento de
//     subpixel ou pequenos ajustes de layout;
//   - em conversas curtas que cabem inteiras na tela, nunca aparece.
// ============================================================

export interface ScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

/**
 * Distância mínima (em px) longe do fundo para exibir o botão.
 *
 * ~160px equivale a duas ou três bolhas: perto o suficiente para o
 * botão aparecer assim que o usuário sai do final, longe o suficiente
 * para não piscar por 1-2px de subpixel ou bounce do navegador.
 */
export const SCROLL_TO_BOTTOM_THRESHOLD_PX = 160;

/** Quantos pixels faltam para chegar ao final da área rolável. */
export function distanceFromBottom(metrics: ScrollMetrics): number {
  const { scrollHeight, scrollTop, clientHeight } = metrics;
  if (
    !Number.isFinite(scrollHeight) ||
    !Number.isFinite(scrollTop) ||
    !Number.isFinite(clientHeight)
  ) {
    return 0;
  }
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
}

/** O botão "ir para o final" deve aparecer para estas medidas? */
export function shouldShowScrollToBottom(
  metrics: ScrollMetrics,
  threshold: number = SCROLL_TO_BOTTOM_THRESHOLD_PX,
): boolean {
  if (!Number.isFinite(metrics.clientHeight) || metrics.clientHeight <= 0) {
    return false;
  }
  if (!Number.isFinite(metrics.scrollHeight) || metrics.scrollHeight <= metrics.clientHeight) {
    return false;
  }
  return distanceFromBottom(metrics) > threshold;
}

export interface ScrollableElement {
  scrollHeight: number;
  scrollTop: number;
  scrollTo?: (options: ScrollToOptions) => void;
}

/**
 * Rola o contêiner de mensagens até o final.
 *
 * Usa `scrollTo` com rolagem suave quando disponível e cai para
 * `scrollTop = scrollHeight` em ambientes sem suporte (ou testes).
 */
export function scrollElementToBottom(
  el: ScrollableElement,
  behavior: ScrollBehavior = 'smooth',
): void {
  if (typeof el.scrollTo === 'function') {
    el.scrollTo({ top: el.scrollHeight, behavior });
    return;
  }
  el.scrollTop = el.scrollHeight;
}
