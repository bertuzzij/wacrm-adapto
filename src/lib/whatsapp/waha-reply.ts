/**
 * Maps a customer's answer on WAHA back to the id of the button / list
 * row the CRM sent, so the Flows engine (which routes on ids) advances.
 */

import type { InteractiveMessagePayload } from './interactive'

export interface ReplyOption {
  id: string
  title: string
}

/** Flat, ordered options of an interactive payload (same order as the text menu / poll). */
export function optionsOf(payload: InteractiveMessagePayload): ReplyOption[] {
  return payload.kind === 'buttons'
    ? payload.buttons.map((b) => ({ id: b.id, title: b.title }))
    : payload.sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title })))
}

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

/** "2" picks the second option; otherwise match by title or by id. */
export function matchOption(options: ReplyOption[], input: string): ReplyOption | null {
  const text = normalize(input)
  if (!text) return null
  if (/^\d{1,2}$/.test(text)) return options[Number(text) - 1] ?? null
  return (
    options.find((o) => normalize(o.title) === text) ??
    options.find((o) => o.id === input.trim()) ??
    null
  )
}

type Loose = Record<string, unknown>

const obj = (v: unknown): Loose | null =>
  v && typeof v === 'object' ? (v as Loose) : null
const str = (v: unknown): string | null =>
  typeof v === 'string' && v ? v : null

/**
 * Native button / list answer carried in WAHA's engine-specific `_data`.
 * Shapes seen in WAHA issues (WEBJS and GOWS); null when the message is
 * not a native answer.
 */
export function nativeReply(data: unknown): ReplyOption | null {
  const d = obj(data)
  if (!d) return null

  // WEBJS
  const buttonId = str(d.selectedButtonId)
  if (d.type === 'buttons_response' && buttonId) {
    return { id: buttonId, title: str(d.body) ?? '' }
  }
  const listResponse = obj(d.listResponse)
  const rowId = str(obj(listResponse?.singleSelectReply)?.selectedRowId)
  if (rowId) return { id: rowId, title: str(listResponse?.title) ?? '' }

  // GOWS
  const message = obj(d.Message)
  const buttons = obj(message?.buttonsResponseMessage)
  const gowsButtonId = str(buttons?.selectedButtonID)
  if (gowsButtonId) {
    return { id: gowsButtonId, title: str(buttons?.selectedDisplayText) ?? '' }
  }
  const list = obj(message?.listResponseMessage)
  const gowsRowId = str(obj(list?.singleSelectReply)?.selectedRowID)
  if (gowsRowId) return { id: gowsRowId, title: str(list?.title) ?? '' }

  return null
}
