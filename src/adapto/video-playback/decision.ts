// ============================================================
// Quando (e como) um vídeo da conversa pode ser carregado.
//
// PROBLEMA RELATADO: "todos os vídeos já rodam automaticamente... isso vai
// sobrecarregar meu storage. Quero que o usuário tenha apenas a opção de
// baixar."
//
// Dois custos distintos, que a mudança precisa resolver juntos:
//
//   1. TRÁFEGO/MEMÓRIA. O proxy `/api/whatsapp/media/…` não repassa
//      `Range` e faz `Buffer.from(await response.arrayBuffer())` — o
//      arquivo INTEIRO passa pela RAM do servidor. O maior vídeo da conta
//      tem 300 MB. Uma conversa aberta disparava isso sozinha, porque o
//      player buscava o vídeo ao montar a bolha.
//
//   2. AÇÕES ERRADAS. O botão que abre o player é o que o navegador
//      aproveita para baixar tudo. Quem só queria ver o texto da conversa
//      pagava o custo do vídeo.
//
// A regra: a bolha NÃO busca bytes. Ela mostra um cartão com o que já se
// sabe (tipo, tamanho quando houver) e um botão de play. O vídeo só é
// baixado quando o usuário pede — e o pedido é explícito.
//
// Módulo puro: a decisão é testável sem DOM, sem rede e sem player.
// ============================================================

/**
 * Acima disto o cartão avisa que o arquivo é grande.
 *
 * Não é um bloqueio — é expectativa correta. 25 MB é o ponto em que, numa
 * conexão de celular comum, o play passa a ter espera perceptível em vez
 * de começar quase imediato.
 */
export const LARGE_VIDEO_BYTES = 25 * 1024 * 1024;

/** Como a bolha deve se apresentar. */
export type VideoPresentation = 'card' | 'download-only';

/**
 * Tamanho legível, para o cartão.
 *
 * Devolve null (não "0 B") quando o tamanho é desconhecido: a mensagem
 * antiga não guardou o valor, e inventar zero mentiria sobre o arquivo.
 */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  // Uma casa decimal abaixo de 10 MB (3,4 MB), nenhuma acima (27 MB):
  // precisão que muda decisão é útil; o resto é ruído.
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** True quando o arquivo merece o aviso de "grande". */
export function isLargeVideo(bytes: number | null | undefined): boolean {
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes > LARGE_VIDEO_BYTES;
}

/**
 * Se a bolha pode oferecer o player.
 *
 * `download-only` existe para o caso em que o arquivo é grande demais para
 * valer a espera mesmo sob demanda: oferecer play ali só produz uma tela
 * travada. O usuário ainda baixa — que é o que ele faria de qualquer jeito.
 */
export function videoPresentation(
  bytes: number | null | undefined
): VideoPresentation {
  // Sem tamanho conhecido: trata como tocável. Recusar o player por falta
  // de metadado puniria justamente as mensagens antigas, que são a
  // maioria do acervo.
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return 'card';
  return bytes > LARGE_VIDEO_BYTES * 4 ? 'download-only' : 'card';
}

/**
 * O que escrever no cartão quando o tamanho é conhecido.
 *
 * Separado de `formatBytes` porque a frase inclui o aviso de arquivo
 * grande, e o chamador precisa das duas informações juntas para não montar
 * a string no JSX (onde fica impossível testar).
 */
export function videoCardSubtitle(
  bytes: number | null | undefined,
  labels: { large: string; video: string }
): string {
  const size = formatBytes(bytes);
  if (!size) return labels.video;
  return isLargeVideo(bytes) ? `${size} · ${labels.large}` : size;
}
