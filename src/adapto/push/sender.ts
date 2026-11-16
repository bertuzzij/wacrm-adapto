import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  isOneSignalConfigured,
  notificationIconUrl,
  onesignalAppId,
  onesignalRestKey,
} from '@/adapto/onesignal/config'

/**
 * Envio de push pelo OneSignal — o aviso que chega com o app FECHADO.
 *
 * ## Por que o envio é por `external_id` e não por Subscription ID
 *
 * O OneSignal tem dois níveis: a Subscription (um navegador/aparelho) e o
 * User (a pessoa, com N subscriptions). O id do usuário no nosso sistema é
 * `auth.users.id`, e é ele que vai como `external_id` no `login()` do SDK.
 *
 * Mirar no User em vez da Subscription é o que faz o aviso chegar em TODOS
 * os aparelhos daquela pessoa sem o nosso banco saber qual endpoint é qual.
 * A tabela `push_subscriptions` da versão VAPID existia justamente para
 * isso; o OneSignal agora é a fonte da verdade.
 *
 * ## Por que a conta inteira, e não só o responsável
 *
 * O aviso é "chegou mensagem", e qualquer pessoa da equipe pode atender —
 * comportamento já em produção, agora preservado. A resolução da lista de
 * membros fica em `accountMembers()`, e o envio usa `include_aliases` com
 * o array inteiro.
 *
 * ## Nunca lança
 *
 * O chamador é o webhook do WhatsApp, que precisa responder 200 ao WAHA. Um
 * erro de push não pode desfazer a mensagem já gravada — por isso tudo aqui
 * devolve um resultado em vez de propagar exceção.
 */

const ONESIGNAL_API = 'https://api.onesignal.com/notifications'

/** Limite da API: até 20.000 aliases por chamada. Muito acima do real. */
const MAX_ALIASES = 20000

export interface PushPayload {
  title: string
  body: string
  /** Agrupa: um aviso por conversa, o novo substitui o anterior. */
  tag?: string
  /** Rota aberta no clique. */
  url?: string
  icon?: string
}

export interface PushResult {
  /** Quantos destinatários foram aceitos pela API. */
  sent: number
  /** Sempre 0: o OneSignal descarta inscrições mortas por conta própria. */
  pruned: number
  /** `true` quando faltam credenciais ou não há destinatário. */
  skipped: boolean
  /** Motivo, para o log do webhook poder explicar sem abrir exceção. */
  reason?: string
}

/** Reaproveita o nome e o contrato da versão VAPID. */
export function isPushConfigured(): boolean {
  return isOneSignalConfigured()
}

/**
 * Os `auth.users.id` dos membros de uma conta.
 *
 * `profiles` é a tabela de vínculo: `profiles.user_id` aponta para
 * `auth.users`, NÃO `profiles.id` (que é a PK da linha). Comparar pela
 * coluna errada compila, roda e devolve vazio — erro já pago neste fork.
 */
async function accountMembers(accountId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)

  if (error) {
    console.error('[push] falha ao listar membros da conta:', error.message)
    return []
  }

  return ((data ?? []) as Array<{ user_id: string | null }>)
    .map((row) => row.user_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/** Formato do corpo aceito pela API REST. Só o que usamos. */
interface OneSignalBody {
  app_id: string
  include_subscription_ids: string[]
  headings: { en: string }
  contents: { en: string }
  web_url?: string
  chrome_web_icon?: string
  /**
   * TTL em segundos. 3 dias é o padrão da API; explicitamos para o aviso de
   * um chat antigo não chegar dias depois sem contexto.
   */
  ttl: number
}

/** Uma inscrição como a API legada de players devolve. */
interface PlayerRow {
  id: string
  external_user_id: string | null
  invalid_identifier: boolean
}

/**
 * As inscrições VÁLIDAS dos usuários informados.
 *
 * Consulta a API legada `players` porque é a única que lista inscrições por
 * app com o campo `invalid_identifier` — e é justamente esse campo que
 * separa os aparelhos que funcionam dos registros mortos deixados por
 * tentativas antigas de inscrição.
 *
 * Devolve `[]` em qualquer erro: o chamador trata como "nada a enviar", e o
 * webhook não quebra.
 */
async function activeSubscriptionIds(externalIds: string[]): Promise<string[]> {
  const appId = onesignalAppId()
  const restKey = onesignalRestKey()
  if (!appId || !restKey) return []

  try {
    // `limit=300` é o máximo da API. Uma conta com mais de 300 inscrições
    // teria de paginar; nesta instalação uma conta tem uma pessoa.
    const response = await fetch(
      `https://api.onesignal.com/players?app_id=${appId}&limit=300`,
      { headers: { Authorization: `Basic ${restKey}` } }
    )
    if (!response.ok) {
      console.error(`[push] players respondeu HTTP ${response.status}`)
      return []
    }

    const json = (await response.json().catch(() => null)) as
      | { players?: PlayerRow[] }
      | null
    const players = json?.players ?? []

    // Só as válidas E de alguém desta conta: enviar para a inscrição de
    // outra pessoa vazaria o conteúdo da mensagem.
    const wanted = new Set(externalIds)
    return players
      .filter(
        (p) =>
          p.invalid_identifier !== true &&
          typeof p.external_user_id === 'string' &&
          wanted.has(p.external_user_id)
      )
      .map((p) => p.id)
  } catch (err) {
    console.error('[push] falha ao listar inscrições:', err)
    return []
  }
}

/**
 * Envia um aviso para TODOS os membros de uma conta.
 *
 * Por conta e não por usuário: o aviso é "chegou mensagem", e qualquer
 * pessoa da equipe pode atender. Quem não quer receber desliga no próprio
 * aparelho, pelo card de Configurações.
 */
export async function sendPushToAccount(
  accountId: string,
  payload: PushPayload
): Promise<PushResult> {
  if (!isOneSignalConfigured()) {
    return { sent: 0, pruned: 0, skipped: true, reason: 'not-configured' }
  }

  const externalIds = await accountMembers(accountId)
  if (externalIds.length === 0) {
    return { sent: 0, pruned: 0, skipped: true, reason: 'no-members' }
  }

  const appId = onesignalAppId()!
  const restKey = onesignalRestKey()!

  // -------------------------------------------------------------------
  // Alvo: subscription_ids, NÃO external_id.
  //
  // Medido em produção, com um usuário que tinha 3 inscrições (1 válida e
  // 2 mortas de tentativas antigas). Enviar por `include_aliases` devolvia:
  //
  //   {"errors":{"invalid_aliases":{"external_id":["2ae39d2c-...",
  //                                                "2ae39d2c-..."]}}}
  //
  // Ou seja: UMA inscrição inválida no mesmo usuário envenena o alias
  // inteiro e o envio não sai para NINGUÉM — nem para os aparelhos bons.
  // O mesmo envio por `include_subscription_ids` devolveu
  // successful=1, failed=0.
  //
  // A causa das inscrições mortas é a nossa própria migração: cada
  // tentativa com o service worker no caminho errado (Typical Site x
  // Custom Code) registrou um aparelho que nunca completou. Elas ficam no
  // OneSignal como `invalid_identifier=true`.
  //
  // Alvo por subscription_id também é mais preciso: o aviso vai para os
  // aparelhos que existem, em vez de depender de o alias estar limpo.
  // -------------------------------------------------------------------
  const subscriptionIds = await activeSubscriptionIds(externalIds)
  if (subscriptionIds.length === 0) {
    return { sent: 0, pruned: 0, skipped: true, reason: 'no-subscriptions' }
  }

  const body: OneSignalBody = {
    app_id: appId,
    include_subscription_ids: subscriptionIds.slice(0, MAX_ALIASES),
    // `en` é a chave obrigatória do formato multilíngue. O TEXTO já vem
    // traduzido do `buildPushPayload` (pt-BR); a chave é só o rótulo do
    // idioma no protocolo, não o idioma do texto.
    headings: { en: payload.title },
    contents: { en: payload.body },
    ttl: 3 * 24 * 60 * 60,
  }

  if (payload.url) body.web_url = payload.url
  // `web_push_topic` NÃO é usado: a doc diz "avoid replacing older web
  // notifications by using unique web_push_topic values". Usá-lo com um
  // valor fixo por conversa fazia cada aviso SUBSTITUIR o anterior — o
  // sintoma era "hora aparece, hora não". Sem ele, cada aviso fica
  // visível por conta própria.
  const icon = payload.icon ?? notificationIconUrl()
  if (icon) body.chrome_web_icon = icon

  try {
    const response = await fetch(ONESIGNAL_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // Formato exato da API: `Key <valor>`. Sem o prefixo, é 401.
        Authorization: `Key ${restKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      // 401/403 = chave errada ou revogada; 400 = corpo inválido. Nenhum
      // dos dois se resolve repetindo, então só registramos.
      const detail = await response.text().catch(() => '')
      console.error(
        `[push] OneSignal recusou (HTTP ${response.status}): ${detail.slice(0, 300)}`
      )
      return { sent: 0, pruned: 0, skipped: false, reason: `http-${response.status}` }
    }

    const json = (await response.json().catch(() => null)) as
      | { id?: string; recipients?: number }
      | null

    return {
      sent: typeof json?.recipients === 'number' ? json.recipients : externalIds.length,
      pruned: 0,
      skipped: false,
    }
  } catch (err) {
    // Timeout/rede: o aviso se perde, mas a mensagem no CRM já está salva.
    console.error('[push] falha de rede ao chamar o OneSignal:', err)
    return { sent: 0, pruned: 0, skipped: false, reason: 'network' }
  }
}
