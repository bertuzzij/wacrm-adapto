import type { SupabaseClient } from '@supabase/supabase-js'
import {
  canAdvanceMessageStatus,
  furthestReachableStatus,
  isMessageStatus,
  statusesAdvanceableTo,
} from './message-status'

export interface MessageStatusFailure {
  code: number
  title: string
  details: string | null
}

export interface IncomingMessageStatus {
  wamid: string
  status: string
  failure: MessageStatusFailure | null
  statusAt: string | null
}

export interface AdvancedMessage {
  id: string
  conversation_id: string
}

interface AccountMessage extends AdvancedMessage {
  status: string
}

interface PendingStatusRow {
  status: string
  error_code: number | null
  error_title: string | null
  error_details: string | null
}

export const PENDING_STATUS_TTL_MS = 24 * 60 * 60 * 1000

/**
 * True para um id de mensagem de grupo no formato `<fromMe>_<jid@g.us>_<stanza>`.
 *
 * Só esses ganham a busca tolerante abaixo: em conversa individual o id
 * sempre foi estável e não existe "linha antiga com sufixo" a encontrar.
 */
function isGroupStanzaId(wamid: string): boolean {
  const parts = wamid.split('_')
  return parts.length === 3 && parts[1]?.endsWith('@g.us') === true
}

/** Escapa `\`, `%` e `_` para uso em LIKE — o `_` sozinho é curinga. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

async function findAccountMessages(
  db: SupabaseClient,
  accountId: string,
  wamid: string,
): Promise<AccountMessage[] | null> {
  const { data, error } = await db
    .from('messages')
    .select('id, conversation_id, status, conversations!inner(account_id)')
    .eq('message_id', wamid)
    .eq('conversations.account_id', accountId)

  if (error) {
    console.error('[message-status] message lookup failed:', error.message)
    return null
  }
  const rows = (data ?? []) as AccountMessage[]
  if (rows.length > 0 || !isGroupStanzaId(wamid)) return rows

  // Linhas gravadas antes de 24/11/2026 carregam um quarto segmento com o
  // participante (`…_<stanza>_5516996066156@c.us`), e nunca mais seriam
  // encontradas por igualdade depois que o id passou a ser normalizado
  // para o stanza. Sem esta busca tolerante, o ack dessas mensagens fica
  // parqueado para sempre e elas travam em `sent`.
  // Ver `@/adapto/whatsapp-groups/message-key`.
  const { data: legacy, error: legacyError } = await db
    .from('messages')
    .select('id, conversation_id, status, conversations!inner(account_id)')
    .like('message_id', `${escapeLike(wamid)}\\_%`)
    .eq('conversations.account_id', accountId)

  if (legacyError) {
    // Devolver vazio (e não `rows`) para o chamador parquear o status em vez
    // de aplicá-lo: o parqueado é reaplicado quando o envio terminar, ao
    // passo que um ack dado como aplicado sem ter encontrado a linha não
    // volta mais.
    console.error('[message-status] legacy id lookup failed:', legacyError.message)
    return []
  }
  return (legacy ?? []) as AccountMessage[]
}

async function advanceMessages(
  db: SupabaseClient,
  rows: AccountMessage[],
  status: string,
  failure: MessageStatusFailure | null,
): Promise<AdvancedMessage[]> {
  const ids = rows
    .filter((row) => canAdvanceMessageStatus(row.status, status))
    .map((row) => row.id)
  if (ids.length === 0) return []

  const patch: Record<string, unknown> = { status }
  if (status === 'failed' && failure) {
    patch.error_code = failure.code
    patch.error_title = failure.title
    patch.error_details = failure.details
  }

  const { data, error } = await db
    .from('messages')
    .update(patch)
    .in('id', ids)
    .in('status', statusesAdvanceableTo(status))
    .select('id, conversation_id')

  if (error) {
    console.error('[message-status] status update failed:', error.message)
    return []
  }
  return (data ?? []) as AdvancedMessage[]
}

async function storePendingStatus(
  db: SupabaseClient,
  accountId: string,
  incoming: IncomingMessageStatus,
): Promise<void> {
  const { error } = await db.from('pending_message_statuses').upsert(
    {
      account_id: accountId,
      wamid: incoming.wamid,
      status: incoming.status,
      error_code: incoming.failure?.code ?? null,
      error_title: incoming.failure?.title ?? null,
      error_details: incoming.failure?.details ?? null,
      status_at: incoming.statusAt,
    },
    { onConflict: 'account_id,wamid,status', ignoreDuplicates: true },
  )
  if (error) {
    console.error('[message-status] parking early status failed:', error.message)
    return
  }

  const { error: pruneError } = await db
    .from('pending_message_statuses')
    .delete()
    .lt('created_at', new Date(Date.now() - PENDING_STATUS_TTL_MS).toISOString())
  if (pruneError) {
    console.error('[message-status] pruning stale early statuses failed:', pruneError.message)
  }
}

export async function applyPendingMessageStatuses(
  db: SupabaseClient,
  accountId: string,
  wamid: string,
): Promise<AdvancedMessage[]> {
  if (!wamid) return []

  const { data: pending, error } = await db
    .from('pending_message_statuses')
    .select('status, error_code, error_title, error_details')
    .eq('account_id', accountId)
    .eq('wamid', wamid)

  if (error) {
    console.error('[message-status] early status lookup failed:', error.message)
    return []
  }
  const parked = (pending ?? []) as PendingStatusRow[]
  if (parked.length === 0) return []

  const rows = await findAccountMessages(db, accountId, wamid)
  if (!rows || rows.length === 0) return []

  const advanced: AdvancedMessage[] = []
  for (const row of rows) {
    const target = furthestReachableStatus(
      row.status,
      parked.map((p) => p.status),
    )
    if (!target) continue
    const failed = parked.find((p) => p.status === 'failed')
    const failure =
      target === 'failed' && failed && failed.error_code !== null
        ? {
            code: failed.error_code,
            title: failed.error_title ?? '',
            details: failed.error_details,
          }
        : null
    advanced.push(...(await advanceMessages(db, [row], target, failure)))
  }

  const { error: clearError } = await db
    .from('pending_message_statuses')
    .delete()
    .eq('account_id', accountId)
    .eq('wamid', wamid)
  if (clearError) {
    console.error('[message-status] clearing applied early statuses failed:', clearError.message)
  }

  return advanced
}

export async function applyMessageStatus(
  db: SupabaseClient,
  accountId: string,
  incoming: IncomingMessageStatus,
): Promise<AdvancedMessage[]> {
  if (!isMessageStatus(incoming.status)) return []
  const rows = await findAccountMessages(db, accountId, incoming.wamid)
  if (!rows) return []
  if (rows.length > 0) {
    return advanceMessages(db, rows, incoming.status, incoming.failure)
  }

  await storePendingStatus(db, accountId, incoming)
  return applyPendingMessageStatuses(db, accountId, incoming.wamid)
}
