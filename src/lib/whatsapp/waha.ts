/**
 * WAHA (WhatsApp HTTP API, unofficial) transport.
 *
 * Activated when `WAHA_URL` is set. In that mode the helpers in
 * `meta-api.ts` send through WAHA instead of Meta's Graph API, and
 * `/api/whatsapp/waha-webhook` translates WAHA events into the Meta
 * webhook shape so the rest of the CRM (inbox, automations, flows)
 * works unchanged.
 *
 * Env:
 *   WAHA_URL      base URL of the WAHA server, e.g. https://waha.example.com
 *   WAHA_API_KEY  value for the X-Api-Key header (optional if WAHA has no key)
 *   WAHA_SESSION  session name (default: "default")
 *
 * Reminder: WAHA is not endorsed by WhatsApp. Use it for testing.
 */

import {
  buttonsAsList,
  interactiveStrategies,
  parseInteractiveMode,
  pollPayloadFor,
  type WahaInteractiveMode,
} from '@/adapto/waha-interactive/strategy'

export type { WahaInteractiveMode }

export function isWahaMode(): boolean {
  return Boolean(process.env.WAHA_URL?.trim())
}

export function wahaSession(): string {
  return process.env.WAHA_SESSION?.trim() || 'default'
}

export function wahaBaseUrl(): string {
  return (process.env.WAHA_URL ?? '').trim().replace(/\/+$/, '')
}

export class WahaApiError extends Error {
  readonly httpStatus: number
  constructor(message: string, httpStatus: number) {
    super(message)
    this.name = 'WahaApiError'
    this.httpStatus = httpStatus
  }
}

function wahaHeaders(json = true): Record<string, string> {
  const headers: Record<string, string> = {}
  if (json) headers['Content-Type'] = 'application/json'
  const key = process.env.WAHA_API_KEY?.trim()
  if (key) headers['X-Api-Key'] = key
  return headers
}

async function wahaRequest<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${wahaBaseUrl()}${path}`, {
    method,
    headers: wahaHeaders(body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 300)
    } catch {
      // ignore
    }
    throw new WahaApiError(
      `WAHA error ${response.status}${detail ? `: ${detail}` : ''}`,
      response.status,
    )
  }
  const text = await response.text()
  return (text ? JSON.parse(text) : {}) as T
}

// ------------------------------------------------------------
// Id helpers
// ------------------------------------------------------------

/** `5511999999999` | `+55 11 99999-9999` | `5511999999999@c.us` → `5511999999999@c.us`. */
export function toChatId(to: string): string {
  const trimmed = to.trim()
  if (trimmed.includes('@')) return trimmed
  return `${trimmed.replace(/\D/g, '')}@c.us`
}

/** `5511999999999@c.us` → `5511999999999`. */
export function chatIdToPhone(chatId: string): string {
  return chatId.split('@')[0].replace(/\D/g, '')
}

/** WAHA returns the message id as a string (new) or `{ _serialized }` (old). */
function extractMessageId(data: unknown): string {
  const d = data as {
    id?: string | { _serialized?: string }
    _data?: { id?: { _serialized?: string } }
  }
  if (typeof d?.id === 'string') return d.id
  if (d?.id && typeof d.id === 'object' && d.id._serialized) return d.id._serialized
  const nested = d?._data?.id?._serialized
  if (nested) return nested
  throw new WahaApiError('WAHA did not return a message id', 502)
}

// ------------------------------------------------------------
// Sending
// ------------------------------------------------------------

export async function wahaSendText(args: {
  to: string
  text: string
  replyTo?: string
  /** JIDs (`5516…@c.us`) a marcar como menção no texto. */
  mentions?: string[]
}): Promise<{ messageId: string }> {
  const data = await wahaRequest('POST', '/api/sendText', {
    session: wahaSession(),
    chatId: toChatId(args.to),
    text: args.text,
    ...(args.replyTo ? { reply_to: args.replyTo } : {}),
    // O WAHA só renderiza a menção como chip se o JID vier nesta lista;
    // o `@telefone` no texto sozinho fica como texto literal.
    ...(args.mentions && args.mentions.length > 0
      ? { mentions: args.mentions }
      : {}),
  })
  return { messageId: extractMessageId(data) }
}

export async function wahaSendMedia(args: {
  to: string
  kind: 'image' | 'video' | 'document' | 'audio'
  link: string
  caption?: string
  filename?: string
  replyTo?: string
}): Promise<{ messageId: string }> {
  const endpoint = {
    image: '/api/sendImage',
    video: '/api/sendVideo',
    document: '/api/sendFile',
    audio: '/api/sendVoice',
  }[args.kind]

  const file: Record<string, string> = { url: args.link }
  if (args.kind === 'document' && args.filename) file.filename = args.filename
  // WAHA requires a mimetype on the file object for most engines.
  file.mimetype = guessMimeType(args.link, args.kind)

  const data = await wahaRequest('POST', endpoint, {
    session: wahaSession(),
    chatId: toChatId(args.to),
    file,
    ...(args.caption && args.kind !== 'audio' ? { caption: args.caption } : {}),
    ...(args.replyTo ? { reply_to: args.replyTo } : {}),
  })
  return { messageId: extractMessageId(data) }
}

function guessMimeType(link: string, kind: string): string {
  const path = link.split('?')[0].toLowerCase()
  const ext = path.includes('.') ? path.split('.').pop()! : ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg; codecs=opus',
    opus: 'audio/ogg; codecs=opus',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    txt: 'text/plain',
    zip: 'application/zip',
  }
  if (map[ext]) return map[ext]
  return {
    image: 'image/jpeg',
    video: 'video/mp4',
    audio: 'audio/ogg; codecs=opus',
    document: 'application/octet-stream',
  }[kind as 'image' | 'video' | 'audio' | 'document']
}

// ------------------------------------------------------------
// Interactive messages (buttons / lists)
// ------------------------------------------------------------

/**
 * How buttons and lists are delivered over WAHA (`WAHA_INTERACTIVE_MODE`).
 *
 *   list (default)  native /api/sendList; a button payload is sent as a
 *                   one-section list, because GOWS answers 501 to
 *                   /api/sendButtons. The recipient sees the same
 *                   "Ver opções" button either way.
 *   buttons         same as `list` — kept so existing deployments that
 *                   already set this value keep working.
 *   poll            WhatsApp poll; the vote arrives as a `poll.vote` event.
 *                   Flattens sections into a single question.
 *   text            numbered text menu; "1" or the option title is the answer.
 *
 * Every mode falls back towards `text`, which always works. Every answer is
 * mapped back to the original button/row id by the /api/whatsapp/waha-webhook
 * bridge, so flows advance in all modes.
 *
 * The strategy table lives in src/adapto/waha-interactive/strategy.ts.
 */
export function wahaInteractiveMode(): WahaInteractiveMode {
  return parseInteractiveMode(process.env.WAHA_INTERACTIVE_MODE)
}

export interface WahaOption {
  id: string
  title: string
  description?: string
}

interface WahaInteractiveBase {
  to: string
  bodyText: string
  headerText?: string
  footerText?: string
  replyTo?: string
}

type WahaGroup = { title?: string; options: WahaOption[] }

export function buildTextMenu(base: WahaInteractiveBase, groups: WahaGroup[]): string {
  let n = 0
  const blocks = groups.map((g) => {
    const lines = g.options.map((o) => {
      n += 1
      return `${n}. ${o.title}${o.description ? ` - ${o.description}` : ''}`
    })
    return [g.title ? `*${g.title}*` : null, ...lines].filter(Boolean).join('\n')
  })
  return [base.headerText, base.bodyText, blocks.join('\n\n'), base.footerText]
    .filter(Boolean)
    .join('\n\n')
}

async function sendInteractiveWithFallback(
  base: WahaInteractiveBase,
  groups: WahaGroup[],
  native: () => Promise<unknown>,
): Promise<{ messageId: string }> {
  const strategies = interactiveStrategies(wahaInteractiveMode())
  let lastError: unknown = null

  for (const strategy of strategies) {
    // `text` nunca falha por motivo de API: é um envio de texto comum.
    if (strategy === 'text') break

    try {
      if (strategy === 'native') {
        const data = await native()
        return { messageId: extractMessageId(data) }
      }

      // strategy === 'poll'
      const poll = pollPayloadFor(base.headerText, base.bodyText, groups)
      if (!poll) {
        // Sem opções não existe enquete válida; segue para o texto.
        continue
      }
      const data = await wahaRequest('POST', '/api/sendPoll', {
        session: wahaSession(),
        chatId: toChatId(base.to),
        poll: { name: poll.name, options: poll.options, multipleAnswers: false },
        ...(base.replyTo ? { reply_to: base.replyTo } : {}),
      })
      return { messageId: extractMessageId(data) }
    } catch (err) {
      if (!(err instanceof WahaApiError)) throw err
      lastError = err
      console.warn(`[waha] ${strategy} send failed, trying the next strategy:`, err.message)
    }
  }

  // Último recurso: menu numerado em texto. Funciona em qualquer motor.
  void lastError
  return wahaSendText({
    to: base.to,
    text: buildTextMenu(base, groups),
    replyTo: base.replyTo,
  })
}

export function wahaSendButtons(
  args: WahaInteractiveBase & { buttons: WahaOption[] },
): Promise<{ messageId: string }> {
  return sendInteractiveWithFallback(args, [{ options: args.buttons }], async () => {
    try {
      return await wahaRequest('POST', '/api/sendButtons', {
        session: wahaSession(),
        chatId: toChatId(args.to),
        ...(args.headerText ? { header: args.headerText } : {}),
        body: args.bodyText,
        ...(args.footerText ? { footer: args.footerText } : {}),
        buttons: args.buttons.map((b) => ({ type: 'reply', id: b.id, text: b.title })),
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      })
    } catch (err) {
      // GOWS responde 501 aqui: botões nativos não existem nesse motor.
      // Em vez de degradar para enquete, reenvia como lista de uma seção —
      // o cliente vê o mesmo botão "Ver opções" e escolhe a opção.
      if (!(err instanceof WahaApiError)) throw err
      const asList = buttonsAsList(args.buttons)
      if (!asList) throw err
      console.warn('[waha] sendButtons refused, sending a one-section list instead:', err.message)
      return wahaRequest('POST', '/api/sendList', {
        session: wahaSession(),
        chatId: toChatId(args.to),
        message: {
          title: args.headerText ?? args.bodyText.slice(0, 60),
          description: args.bodyText,
          footer: args.footerText ?? '',
          button: asList.buttonLabel,
          sections: [{ title: 'Options', rows: asList.sections[0].rows.map((r) => ({ title: r.title, rowId: r.id })) }],
        },
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      })
    }
  })
}

export function wahaSendList(
  args: WahaInteractiveBase & {
    buttonLabel: string
    sections: Array<{ title?: string; rows: WahaOption[] }>
  },
): Promise<{ messageId: string }> {
  return sendInteractiveWithFallback(
    args,
    args.sections.map((s) => ({ title: s.title, options: s.rows })),
    () =>
      wahaRequest('POST', '/api/sendList', {
        session: wahaSession(),
        chatId: toChatId(args.to),
        message: {
          title: args.headerText ?? args.bodyText.slice(0, 60),
          description: args.bodyText,
          footer: args.footerText ?? '',
          button: args.buttonLabel,
          sections: args.sections.map((s) => ({
            title: s.title ?? 'Options',
            rows: s.rows.map((r) => ({
              title: r.title,
              rowId: r.id,
              description: r.description ?? null,
            })),
          })),
        },
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      }),
  )
}

export async function wahaSendReaction(args: {
  targetMessageId: string
  emoji: string
}): Promise<{ messageId: string }> {
  await wahaRequest('PUT', '/api/reaction', {
    session: wahaSession(),
    messageId: args.targetMessageId,
    reaction: args.emoji,
  })
  // WAHA mints no id for reactions; the caller only needs a stable string.
  return { messageId: `waha-reaction-${args.targetMessageId}-${Date.now()}` }
}

/** Mark an inbound message as read and show "typing…". Best-effort. */
export async function wahaTyping(args: { messageId: string }): Promise<void> {
  // Message ids look like `false_5511999999999@c.us_3EB0...`.
  const parts = args.messageId.split('_')
  const chatId = parts.length >= 3 ? parts[1] : null
  if (!chatId) return
  await wahaRequest('POST', '/api/sendSeen', {
    session: wahaSession(),
    chatId,
  })
  await wahaRequest('POST', '/api/startTyping', {
    session: wahaSession(),
    chatId,
  })
}

// ------------------------------------------------------------
// Session / identity
// ------------------------------------------------------------

export interface WahaSessionInfo {
  name: string
  status: string
  me?: { id?: string; pushName?: string } | null
}

export async function wahaGetSession(): Promise<WahaSessionInfo> {
  return wahaRequest<WahaSessionInfo>(
    'GET',
    `/api/sessions/${encodeURIComponent(wahaSession())}`,
  )
}

/** Resolve a `@lid` identifier to the real phone number, when WAHA knows it. */
export async function wahaResolveLid(lid: string): Promise<string | null> {
  try {
    const data = await wahaRequest<{ pn?: string | null }>(
      'GET',
      `/api/${encodeURIComponent(wahaSession())}/lids/${encodeURIComponent(lid)}`,
    )
    return data.pn ? chatIdToPhone(data.pn) : null
  } catch {
    return null
  }
}

// ------------------------------------------------------------
// Media
// ------------------------------------------------------------

const MEDIA_ID_PREFIX = 'waha_'

/** Encode the WAHA file path into a path-safe id the existing media pipeline can carry. */
export function encodeWahaMediaId(url: string): string {
  let path = url
  try {
    const u = new URL(url)
    path = `${u.pathname}${u.search}`
  } catch {
    // already a path
  }
  return MEDIA_ID_PREFIX + Buffer.from(path, 'utf8').toString('base64url')
}

export function isWahaMediaId(id: string): boolean {
  return id.startsWith(MEDIA_ID_PREFIX)
}

export function decodeWahaMediaUrl(id: string): string {
  const path = Buffer.from(id.slice(MEDIA_ID_PREFIX.length), 'base64url').toString('utf8')
  return `${wahaBaseUrl()}${path.startsWith('/') ? '' : '/'}${path}`
}

export async function wahaDownload(
  url: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const response = await fetch(url, { headers: wahaHeaders(false) })
  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status}`)
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  }
}

export async function wahaHeadMedia(
  url: string,
): Promise<{ mimeType: string; fileSize: number | null }> {
  try {
    const response = await fetch(url, { method: 'HEAD', headers: wahaHeaders(false) })
    const size = Number(response.headers.get('content-length'))
    return {
      mimeType: response.headers.get('content-type') || 'application/octet-stream',
      fileSize: Number.isFinite(size) && size > 0 ? size : null,
    }
  } catch {
    return { mimeType: 'application/octet-stream', fileSize: null }
  }
}

/**
 * Marca um chat como lido no WhatsApp (o contato deixa de ver "não lido").
 *
 * Endpoint: `POST /api/sendSeen` com `{ session, chatId }` — não é
 * `/api/{session}/sendSeen` (404 nesta versão). Sem `chatId` o servidor
 * responde 500 com `Cannot read properties of undefined (reading
 * 'includes')`, que não diz nada sobre o parâmetro faltando; por isso a
 * validação é feita aqui antes.
 *
 * Resposta 201 traz `{ ids: [...] }` com as mensagens marcadas.
 *
 * Não confundir com `wahaTyping`, que já dispara `sendSeen` mas só é
 * chamado pela auto-resposta da IA. Quem lê manualmente nunca passava por
 * lá — era esse o motivo de o contato continuar vendo a conversa como
 * não lida.
 */
export async function wahaSendSeen(
  chatId: string,
): Promise<{ ids: string[] }> {
  const cleaned = chatId.trim();
  if (!cleaned) throw new WahaApiError('chatId vazio', 400);
  const data = await wahaRequest<{ ids?: string[] }>('POST', '/api/sendSeen', {
    session: wahaSession(),
    chatId: cleaned,
  });
  return { ids: Array.isArray(data?.ids) ? data.ids : [] };
}

// ------------------------------------------------------------
// Profile / contact enrichment (read-only)
//
// The only read paths that actually work on WAHA 2026.7.2 (CORE / GOWS),
// verified against a running instance:
//
//   GET /api/{session}/chats/{chatId}/picture  -> { url } | null
//   GET /api/{session}/chats?limit=&offset=    -> [{ id, name, ... }]
//
// Things that do NOT work and should not be reintroduced:
//
//   GET /api/{session}/profile?contactId=X
//     Accepts the parameter and returns HTTP 200, but always answers with the
//     session's OWN profile. Using it to enrich contacts would silently write
//     the operator's own name and photo onto every contact.
//
//   GET /api/{session}/contacts/{id}/picture, /profile-picture, /api/files/*
//     All 404 on this version.
//
// There is no write path for another user's name or photo: the WhatsApp
// protocol does not expose one here. "Sync" therefore means importing what
// the contact already publishes, never setting it.
// ------------------------------------------------------------

export interface WahaChatPicture {
  /** CDN URL, expires in roughly two days — copy the bytes, do not store it. */
  url: string
}

/**
 * Profile picture URL for one chat, or `null` when the contact has none.
 *
 * Returns null rather than throwing for a missing picture: most contacts
 * simply do not have one, and that is not an error worth logging.
 * A 404 means "no picture"; anything else is a real transport failure and
 * propagates so the caller can decide to stop the run.
 */
export async function wahaGetChatPicture(
  chatId: string,
): Promise<WahaChatPicture | null> {
  try {
    const data = await wahaRequest<{ url?: string } | null>(
      'GET',
      `/api/${encodeURIComponent(wahaSession())}/chats/${encodeURIComponent(chatId)}/picture`,
    )
    const url = data?.url?.trim()
    return url ? { url } : null
  } catch (err) {
    if (err instanceof WahaApiError && err.httpStatus === 404) return null
    throw err
  }
}

export interface WahaChatEntry {
  id: string
  name?: string
}

/**
 * Chats known to the session, newest conversation first.
 *
 * Used to learn the address-book name (`name`), which is the label the
 * operator saved for the contact — distinct from `pushname`, the name the
 * contact chose for themselves. `contacts/all` carries only pushname.
 */
export async function wahaListChats(
  limit = 100,
  offset = 0,
): Promise<WahaChatEntry[]> {
  const data = await wahaRequest<WahaChatEntry[]>(
    'GET',
    `/api/${encodeURIComponent(wahaSession())}/chats?limit=${limit}&offset=${offset}`,
  )
  return Array.isArray(data) ? data : []
}

