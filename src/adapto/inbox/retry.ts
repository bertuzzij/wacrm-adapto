// ============================================================
// Reenvio de uma mensagem que falhou.
//
// O problema real: uma mensagem que não sai fica só no estado local do
// React, com status 'failed'. Ao recarregar a página ela DESAPARECE — o
// atendente perde o texto que escreveu e não tem como tentar de novo.
//
// A correção não é guardar a mensagem falhada no banco: ela nunca chegou ao
// WhatsApp, e gravá-la criaria uma linha que não corresponde a nada do outro
// lado (e quebraria contadores de conversa). O que se guarda é o suficiente
// para reenviar: o texto e, quando houver, a mensagem citada.
//
// Este módulo é puro para poder testar a decisão sem rede:
//
//   - mensagem que falhou pode ser reenviada; qualquer outro status não;
//   - o reenvio usa a MESMA idempotência do envio normal (o índice único de
//     conversation_id + message_id no servidor), então clicar duas vezes
//     não manda duas mensagens ao cliente;
//   - o texto vazio não é reenviável — não há o que mandar.
// ============================================================

import type { Message } from '@/types';

/** O mínimo para reenviar, guardado quando o envio falha. */
export interface FailedDraft {
  /** `message.id` da bolha otimista que falhou. */
  tempId: string;
  /** Texto original, exatamente como foi digitado. */
  text: string;
  /** Mensagem citada, quando era uma resposta. */
  replyToId?: string;
}

/** Uma mensagem nesta bolha pode ser reenviada? */
export function canRetry(message: Pick<Message, 'status' | 'content_type' | 'content_text'>): boolean {
  if (message.status !== 'failed') return false;

  // Mídia e template não são reenviáveis por aqui: o arquivo já foi enviado
  // ao Storage e o caminho de reenvio exigiria reconstruir aquele payload.
  // Reenviar o texto de uma bolha de mídia mandaria uma mensagem vazia.
  if (message.content_type !== 'text') return false;

  return typeof message.content_text === 'string' && message.content_text.trim().length > 0;
}

/**
 * Rascunho a partir de uma bolha que falhou.
 *
 * Devolve `null` quando não há o que reenviar — o chamador usa isso para não
 * exibir o botão.
 */
export function failedDraftFrom(message: Message): FailedDraft | null {
  if (!canRetry(message)) return null;
  return {
    tempId: message.id,
    text: message.content_text ?? '',
    replyToId: message.reply_to_message_id ?? undefined,
  };
}

/**
 * Deve pedir confirmação antes de reenviar?
 *
 * Reenviar manda de novo para o CLIENTE. Se o envio anterior chegou mas o
 * status ficou dessincronizado, uma segunda tentativa duplica a mensagem do
 * outro lado — e não há como apagar. Depois de um tempo razoável, a chance
 * de isso ter acontecido cresce, então pedimos confirmação.
 *
 * Dentro da janela, o botão é direto: o caso comum é o envio que falhou de
 * verdade (timeout, rede), e uma confirmação a cada tentativa só atrapalha.
 */
export const RETRY_CONFIRM_AFTER_MS = 60_000;

export function retryNeedsConfirm(
  message: Pick<Message, 'created_at'>,
  now: number = Date.now()
): boolean {
  const created = new Date(message.created_at).getTime();
  if (!Number.isFinite(created)) return true;
  return now - created > RETRY_CONFIRM_AFTER_MS;
}
