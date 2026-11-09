// `web-push` é CommonJS e não expõe `export default` quando consumido pelo
// Turbopack em rota de API — o import nomeado é o único que resolve. O
// namespace inteiro vem em `webpush`.
import * as webpush from 'web-push'
import type { PushSubscription as WebPushSubscription } from 'web-push'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/**
 * Web Push de verdade — o aviso que chega com o app FECHADO.
 *
 * ## Por que isto não existia, e o que muda
 *
 * Até aqui o alerta de mensagem nova vinha do realtime do Supabase dentro
 * da aba aberta (`use-browser-notifications.ts`). No celular, com o app em
 * segundo plano, nada chegava — e no iPhone nem funcionava, porque o WebKit
 * só entrega notificação para app instalado, por Web Push.
 *
 * Este módulo envia pelo protocolo Web Push (VAPID), que é o único caminho
 * que acorda o service worker com o app fechado.
 *
 * ## Configuração
 *
 * Três variáveis, e as chaves NÃO têm valor padrão de propósito:
 *
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY — vai ao navegador, usado em
 *                                  `pushManager.subscribe()`.
 *   VAPID_PRIVATE_KEY            — só no servidor, assina a entrega.
 *   VAPID_SUBJECT                — `mailto:` ou URL de contato. Os serviços
 *                                  de push exigem para contatar quem envia
 *                                  em caso de abuso.
 *
 * Sem as três, `isPushConfigured()` é falso e o envio vira no-op — o app
 * continua funcionando, só sem push. Isso importa: quem roda uma instância
 * sem VAPID não pode ter o webhook quebrando.
 */

let configured: boolean | null = null

/** As três variáveis estão presentes? Não valida o formato da chave. */
export function isPushConfigured(): boolean {
  if (configured !== null) return configured

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT

  configured = Boolean(publicKey && privateKey && subject)

  if (configured) {
    try {
      webpush.setVapidDetails(subject!, publicKey!, privateKey!)
    } catch (err) {
      // Chave com formato inválido é erro de configuração, não de runtime.
      // Desabilita para o app não tentar enviar a cada mensagem.
      console.error('[push] VAPID inválido, push desabilitado:', err)
      configured = false
    }
  }

  return configured
}

/** Apenas para testes: esquece o cache de configuração. */
export function resetPushConfigCache(): void {
  configured = null
}

export interface PushPayload {
  title: string
  body: string
  /** Agrupa: um aviso por conversa, o novo substitui o anterior. */
  tag?: string
  /** Rota aberta no clique. */
  url?: string
  icon?: string
}

/** Uma linha de `push_subscriptions`, no formato que o web-push espera. */
interface SubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

function toWebPush(row: SubscriptionRow): WebPushSubscription {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  }
}

export interface PushResult {
  sent: number
  /** Inscrições removidas por estarem mortas (404/410). */
  pruned: number
  skipped: boolean
}

/**
 * Envia um aviso para TODAS as inscrições de uma conta.
 *
 * Por conta e não por usuário: o aviso é "chegou mensagem", e qualquer
 * pessoa da equipe pode atender. Quem não quer receber desliga no próprio
 * aparelho (a inscrição é removida).
 *
 * Nunca lança: o chamador é um webhook que precisa responder 200 à Meta.
 */
export async function sendPushToAccount(
  accountId: string,
  payload: PushPayload,
): Promise<PushResult> {
  if (!isPushConfigured()) {
    return { sent: 0, pruned: 0, skipped: true }
  }

  const { data, error } = await supabaseAdmin()
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('account_id', accountId)

  if (error) {
    console.error('[push] failed to load subscriptions:', error.message)
    return { sent: 0, pruned: 0, skipped: false }
  }

  const rows = (data ?? []) as SubscriptionRow[]
  if (rows.length === 0) return { sent: 0, pruned: 0, skipped: false }

  const body = JSON.stringify(payload)
  let sent = 0
  const dead: string[] = []

  // Em paralelo: uma conta pode ter vários aparelhos e serializar aqui
  // atrasaria o webhook sem motivo.
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(toWebPush(row), body)
        sent++
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode

        // 404/410 = inscrição não existe mais (app desinstalado, dados do
        // navegador limpos, FCM expirou). Guardar seria acumular lixo e
        // tentar de novo a cada mensagem.
        if (statusCode === 404 || statusCode === 410) {
          dead.push(row.id)
          return
        }

        // 413 = payload maior que o serviço aceita. 429 = rate limit.
        // Nenhum dos dois justifica apagar a inscrição.
        console.error(
          `[push] delivery failed (status ${statusCode ?? '?'}) for subscription ${row.id}`,
        )
      }
    }),
  )

  if (dead.length > 0) {
    const { error: delError } = await supabaseAdmin()
      .from('push_subscriptions')
      .delete()
      .in('id', dead)
    if (delError) {
      console.error('[push] failed to prune dead subscriptions:', delError.message)
    }
  }

  // Marca uso para permitir limpeza de inscrições abandonadas depois.
  if (sent > 0) {
    const { error: touchError } = await supabaseAdmin()
      .from('push_subscriptions')
      .update({ last_used_at: new Date().toISOString() })
      .eq('account_id', accountId)
    if (touchError) {
      console.error('[push] failed to touch last_used_at:', touchError.message)
    }
  }

  return { sent, pruned: dead.length, skipped: false }
}
