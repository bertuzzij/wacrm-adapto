import {
  buildNotificationContent,
  DEFAULT_NOTIFICATION_LABELS,
  pickContactDisplayName,
  type NotificationLabels,
  type NotifiableMessage,
} from '@/lib/notifications/browser-notify'
import { conversationHref } from '@/lib/notifications/browser-notify'
import type { PushPayload } from './sender'

/**
 * Decide SE e O QUE empurrar por Web Push para uma mensagem recebida.
 *
 * Regra de negócio em módulo puro: o mesmo payload alimenta o aviso da aba
 * aberta e o push. Manter a decisão aqui evita as duas divergirem — o
 * sintoma clássico é o toast dizer "Foto" e o push dizer o texto cru.
 */

export interface PushDecisionInput {
  message: Pick<NotifiableMessage, 'conversation_id' | 'sender_type' | 'content_type' | 'content_text'>
  contact: {
    name?: string | null
    wa_username?: string | null
    phone?: string | null
  } | null
  /** Rótulos traduzidos; os padrão em inglês servem quando não há tradutor. */
  labels?: NotificationLabels
  /** Nome do app, usado quando o contato não tem nome resolvível. */
  appName?: string
}

/**
 * Só mensagem de CLIENTE gera push.
 *
 * Mensagem do próprio atendente (enviada pelo celular, `sender_type`
 * 'agent') não é motivo de alerta — ele acabou de escrever. Empurrar isso
 * faria o celular apitar a cada resposta enviada de outro aparelho.
 */
export function shouldPushMessage(
  message: Pick<NotifiableMessage, 'sender_type'>,
): boolean {
  return message.sender_type === 'customer'
}

export function buildPushPayload({
  message,
  contact,
  labels = DEFAULT_NOTIFICATION_LABELS,
  appName,
}: PushDecisionInput): PushPayload | null {
  if (!shouldPushMessage(message)) return null

  const contactName = pickContactDisplayName(contact)
  const { title, body } = buildNotificationContent(
    {
      id: '',
      conversation_id: message.conversation_id,
      sender_type: message.sender_type,
      content_type: message.content_type,
      content_text: message.content_text,
    },
    contactName,
    labels,
  )

  return {
    // Sem nome do contato, o título genérico ("Nova mensagem") sozinho não
    // diz de onde veio no celular — o app identifica o aviso.
    title: appName && !contactName ? `${title} · ${appName}` : title,
    body,
    // Um aviso por conversa: a segunda mensagem substitui a primeira em vez
    // de empilhar cinco avisos do mesmo cliente.
    tag: message.conversation_id,
    url: conversationHref(message.conversation_id),
  }
}
