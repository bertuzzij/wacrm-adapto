import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { POST as metaWebhookPost } from '../webhook/route'
import { findExistingContact } from '@/lib/contacts/dedupe'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import {
  matchOption,
  nativeReply,
  optionsOf,
  type ReplyOption,
} from '@/lib/whatsapp/waha-reply'
import { parseAppSecrets } from '@/lib/whatsapp/webhook-signature'
import { readCappedBody } from '@/lib/whatsapp/webhook-body'
import {
  chatIdToPhone,
  encodeWahaMediaId,
  isWahaMode,
  wahaResolveLid,
} from '@/lib/whatsapp/waha'
import {
  groupDisplayName,
  groupPhoneKey,
  isGroupChatId,
} from '@/adapto/whatsapp-groups/identity'
import { fetchGroupName } from '@/adapto/whatsapp-groups/server'

/**
 * WAHA → CRM bridge.
 *
 * Point WAHA's session webhook at:
 *   {APP_URL}/api/whatsapp/waha-webhook?token={WAHA_WEBHOOK_SECRET}
 * with events `message`, `message.ack`, `message.reaction` and `poll.vote`.
 *
 * Answers to buttons / lists / polls / numbered text menus are converted
 * to an `interactive` button_reply carrying the original button id, so
 * Flows and automations advance exactly as with the official API.
 *
 * Each event is translated to the Meta Cloud API webhook shape and handed
 * to the existing Meta webhook handler (signed with META_APP_SECRET), so
 * contacts, conversations, automations, flows and AI replies all run
 * through the same code path as the official API.
 */

export const maxDuration = 60

interface WahaMedia {
  url?: string | null
  mimetype?: string | null
  filename?: string | null
}

interface WahaPayload {
  id?: string
  timestamp?: number
  from?: string
  to?: string
  fromMe?: boolean
  body?: string
  hasMedia?: boolean
  media?: WahaMedia | null
  replyTo?: { id?: string } | null
  location?: { latitude?: number; longitude?: number; name?: string; address?: string } | null
  ack?: number
  ackName?: string
  reaction?: { text?: string; messageId?: string }
  /** `poll.vote` events. */
  vote?: {
    id?: string
    from?: string
    fromMe?: boolean
    selectedOptions?: string[]
    timestamp?: number
  }
  poll?: { id?: string; fromMe?: boolean }
  _data?: {
    type?: string
    notifyName?: string
    pushName?: string
    key?: { remoteJidAlt?: string }
    [k: string]: unknown
  }
}

interface WahaEvent {
  event?: string
  session?: string
  me?: { id?: string; pushName?: string }
  payload?: WahaPayload
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

interface PromptRow {
  content_type: string | null
  sender_type: string | null
  interactive_payload: InteractiveMessagePayload | null
}

/** The interactive prompt we sent as WhatsApp message `messageId` (poll or text menu). */
async function promptByMessageId(messageId: string): Promise<ReplyOption[] | null> {
  const { data } = await supabaseAdmin()
    .from('messages')
    .select('content_type, sender_type, interactive_payload')
    .eq('message_id', messageId)
    .limit(1)
    .maybeSingle()
  const row = data as PromptRow | null
  if (row?.content_type !== 'interactive' || !row.interactive_payload) return null
  return optionsOf(row.interactive_payload)
}

/**
 * Options of the interactive prompt this contact is currently answering:
 * only when the latest message of the conversation is our prompt, so a
 * stray "1" in an ordinary chat is never hijacked.
 */
async function openPromptFor(myPhone: string, phone: string): Promise<ReplyOption[] | null> {
  const db = supabaseAdmin()
  const { data: cfg } = await db
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', myPhone)
    .maybeSingle()
  if (!cfg) return null
  const contact = await findExistingContact(db, cfg.account_id, phone)
  if (!contact) return null
  const { data: conv } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', cfg.account_id)
    .eq('contact_id', contact.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!conv) return null
  const { data: last } = await db
    .from('messages')
    .select('content_type, sender_type, interactive_payload')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = last as PromptRow | null
  if (
    !row ||
    row.sender_type === 'customer' ||
    row.content_type !== 'interactive' ||
    !row.interactive_payload
  ) {
    return null
  }
  return optionsOf(row.interactive_payload)
}

function tokenOk(request: Request): boolean {
  const expected = process.env.WAHA_WEBHOOK_SECRET?.trim()
  if (!expected) return false
  const url = new URL(request.url)
  const presented =
    url.searchParams.get('token') ?? request.headers.get('x-webhook-token') ?? ''
  const a = crypto.createHash('sha256').update(expected).digest()
  const b = crypto.createHash('sha256').update(presented).digest()
  return crypto.timingSafeEqual(a, b)
}

/**
 * Chats que o CRM não trata como conversa.
 *
 * `@g.us` (grupo) deixou de estar nesta lista: grupos agora viram
 * conversa na inbox, em modo somente leitura. Ver
 * `src/adapto/whatsapp-groups/identity.ts` para como o id de grupo é
 * acomodado num schema que exige `contacts.phone`.
 *
 * `status@` e `@newsletter` continuam fora: não são conversa com
 * ninguém, e não há para onde atribuí-los.
 */
function isIgnoredChat(chatId: string | undefined): boolean {
  if (!chatId) return true
  return chatId.startsWith('status@') || chatId.endsWith('@newsletter')
}

/** Real phone digits for a chat id, resolving `@lid` identifiers when needed. */
async function phoneFor(chatId: string, payload: WahaPayload): Promise<string | null> {
  if (chatId.endsWith('@lid')) {
    const alt = payload._data?.key?.remoteJidAlt
    if (alt && alt.endsWith('@s.whatsapp.net')) return chatIdToPhone(alt)
    return wahaResolveLid(chatId)
  }
  return chatIdToPhone(chatId)
}

function mediaType(media: WahaMedia, wahaType?: string): 'image' | 'video' | 'audio' | 'document' | 'sticker' {
  const mime = (media.mimetype ?? '').toLowerCase()
  if (wahaType === 'sticker') return 'sticker'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

function buildMetaMessage(
  payload: WahaPayload,
  phone: string,
): Record<string, unknown> | null {
  const base = {
    from: phone,
    id: payload.id!,
    timestamp: String(payload.timestamp ?? Math.floor(Date.now() / 1000)),
    ...(payload.replyTo?.id ? { context: { id: payload.replyTo.id } } : {}),
  }

  if (payload.hasMedia && payload.media?.url) {
    const type = mediaType(payload.media, payload._data?.type)
    const entry: Record<string, unknown> = {
      id: encodeWahaMediaId(payload.media.url),
      mime_type: payload.media.mimetype || 'application/octet-stream',
    }
    if (type !== 'audio' && type !== 'sticker' && payload.body) entry.caption = payload.body
    if (type === 'document' && payload.media.filename) entry.filename = payload.media.filename
    return { ...base, type, [type]: entry }
  }

  if (payload.location?.latitude != null && payload.location.longitude != null) {
    return {
      ...base,
      type: 'location',
      location: {
        latitude: payload.location.latitude,
        longitude: payload.location.longitude,
        name: payload.location.name,
        address: payload.location.address,
      },
    }
  }

  const text = payload.body?.trim()
  if (!text) {
    if (payload.hasMedia) return { ...base, type: 'text', text: { body: '[Media unavailable]' } }
    return null
  }
  return { ...base, type: 'text', text: { body: text } }
}

function ackToStatus(payload: WahaPayload): string | null {
  switch (payload.ackName) {
    case 'ERROR':
      return 'failed'
    case 'SERVER':
      return 'sent'
    case 'DEVICE':
      return 'delivered'
    case 'READ':
    case 'PLAYED':
      return 'read'
  }
  switch (payload.ack) {
    case -1:
      return 'failed'
    case 1:
      return 'sent'
    case 2:
      return 'delivered'
    case 3:
    case 4:
      return 'read'
  }
  return null
}

async function matchOpenPrompt(
  myPhone: string,
  phone: string,
  text: string,
): Promise<ReplyOption | null> {
  const options = await openPromptFor(myPhone, phone)
  return options ? matchOption(options, text) : null
}

async function toMetaBody(event: WahaEvent): Promise<Record<string, unknown> | null> {
  const payload = event.payload
  const meId = event.me?.id
  if (!payload || !meId) return null

  const myPhone = chatIdToPhone(meId)
  const metadata = { display_phone_number: myPhone, phone_number_id: myPhone }
  const wrap = (value: Record<string, unknown>) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waha',
        changes: [
          {
            field: 'messages',
            value: { messaging_product: 'whatsapp', metadata, ...value },
          },
        ],
      },
    ],
  })

  const asInteractiveReply = (
    phone: string,
    id: string,
    timestamp: number | undefined,
    picked: ReplyOption,
    name?: string,
  ) =>
    wrap({
      contacts: [{ profile: name ? { name } : {}, wa_id: phone }],
      messages: [
        {
          from: phone,
          id,
          timestamp: String(timestamp ?? Math.floor(Date.now() / 1000)),
          type: 'interactive',
          interactive: {
            type: 'button_reply',
            button_reply: { id: picked.id, title: picked.title },
          },
        },
      ],
    })

  if (event.event === 'poll.vote') {
    const vote = payload.vote
    const pollId = payload.poll?.id
    const chosen = vote?.selectedOptions?.[0]
    if (!vote?.id || !vote.from || !pollId || !chosen) return null
    if (vote.fromMe || !payload.poll?.fromMe || isIgnoredChat(vote.from)) return null
    const phone = await phoneFor(vote.from, payload)
    if (!phone) return null
    const options = await promptByMessageId(pollId)
    const picked = options ? matchOption(options, chosen) : null
    if (!picked) {
      console.warn('[waha-webhook] poll vote did not match a stored prompt:', pollId)
      return null
    }
    // A changed vote reuses the vote id; the timestamp keeps it from being
    // dropped as a duplicate delivery.
    return asInteractiveReply(phone, `${vote.id}:${vote.timestamp ?? ''}`, vote.timestamp, picked)
  }

  if (!payload.id) return null

  if (event.event === 'message.ack') {
    if (!payload.fromMe) return null
    const status = ackToStatus(payload)
    const peer = payload.to ?? payload.from
    if (!status || isIgnoredChat(peer)) return null
    const phone = await phoneFor(peer!, payload)
    if (!phone) return null
    return wrap({
      statuses: [
        {
          id: payload.id,
          status,
          timestamp: String(payload.timestamp ?? Math.floor(Date.now() / 1000)),
          recipient_id: phone,
        },
      ],
    })
  }

  if (event.event === 'message' || event.event === 'message.any') {
    if (payload.fromMe || isIgnoredChat(payload.from)) return null

    // Grupo: o identificador é o JID do grupo (não um telefone) e o nome
    // vem do endpoint de grupos do WAHA — o evento de mensagem não o
    // carrega (ver src/adapto/whatsapp-groups/server.ts).
    if (isGroupChatId(payload.from)) {
      const groupKey = groupPhoneKey(payload.from!)
      const message = buildMetaMessage(payload, groupKey)
      if (!message) return null
      const groupName = await fetchGroupName(payload.from!)
      return wrap({
        contacts: [
          {
            profile: { name: groupDisplayName(groupName) },
            wa_id: groupKey,
          },
        ],
        messages: [message],
      })
    }

    const phone = await phoneFor(payload.from!, payload)
    if (!phone) {
      console.warn('[waha-webhook] could not resolve a phone number for', payload.from)
      return null
    }
    const name = payload._data?.notifyName ?? payload._data?.pushName

    // Button / list taps, and typed answers ("2", "Sim") to our last prompt.
    let picked: ReplyOption | null = nativeReply(payload._data)
    if (!picked && !payload.hasMedia && payload.body) {
      picked = await matchOpenPrompt(myPhone, phone, payload.body)
    }
    if (picked) {
      return asInteractiveReply(phone, payload.id, payload.timestamp, picked, name)
    }

    const message = buildMetaMessage(payload, phone)
    if (!message) return null
    return wrap({
      contacts: [{ profile: name ? { name } : {}, wa_id: phone }],
      messages: [message],
    })
  }

  if (event.event === 'message.reaction') {
    if (payload.fromMe || isIgnoredChat(payload.from)) return null
    const target = payload.reaction?.messageId
    if (!target) return null
    const phone = await phoneFor(payload.from!, payload)
    if (!phone) return null
    return wrap({
      contacts: [{ profile: {}, wa_id: phone }],
      messages: [
        {
          from: phone,
          id: payload.id,
          timestamp: String(payload.timestamp ?? Math.floor(Date.now() / 1000)),
          type: 'reaction',
          reaction: { message_id: target, emoji: payload.reaction?.text ?? '' },
        },
      ],
    })
  }

  return null
}

export async function POST(request: Request) {
  if (!isWahaMode()) {
    return NextResponse.json({ error: 'WAHA mode is disabled (WAHA_URL not set)' }, { status: 404 })
  }
  if (!tokenOk(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawBody = await readCappedBody(request)
  if (rawBody === null) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  let event: WahaEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const secret = parseAppSecrets(process.env.META_APP_SECRET)[0]
  if (!secret) {
    console.error('[waha-webhook] META_APP_SECRET must be set (any value) to bridge events.')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const metaBody = await toMetaBody(event)
  if (!metaBody) return NextResponse.json({ status: 'ignored' }, { status: 200 })

  const raw = JSON.stringify(metaBody)
  const signature =
    'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')

  return metaWebhookPost(
    new Request(new URL('/api/whatsapp/webhook', request.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature },
      body: raw,
    }),
  )
}
