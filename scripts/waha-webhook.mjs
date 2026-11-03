#!/usr/bin/env node
/**
 * Builds (and optionally registers) the WAHA webhook URL that points at this CRM.
 *
 * The URL carries WAHA_WEBHOOK_SECRET as `?token=...`, so the secret is masked
 * unless you ask for it explicitly. Nothing is ever written to the chat/logs.
 *
 * Usage:
 *   node scripts/waha-webhook.mjs                  # show the URL (token masked)
 *   node scripts/waha-webhook.mjs --reveal         # show the full URL
 *   node scripts/waha-webhook.mjs --write          # save the full URL to .waha-webhook-url.txt
 *   node scripts/waha-webhook.mjs --base https://crm.example.com --reveal
 *   node scripts/waha-webhook.mjs --status         # WAHA session + configured webhooks
 *   node scripts/waha-webhook.mjs --base https://crm.example.com --register
 *   node scripts/waha-webhook.mjs --base https://crm.example.com --register --append
 *   node scripts/waha-webhook.mjs --base https://crm.example.com --register --dry-run
 *
 * `--base` may also come from NEXT_PUBLIC_SITE_URL in the env files.
 *
 * REGISTERING REPLACES the session's webhook list by default — the CRM becomes
 * the only receiver. Pass `--append` to keep the other entries. Either way the
 * previous list is written to `.waha-webhooks.backup-<timestamp>.json` first,
 * so a mistake is one PUT away from being undone.
 *
 * Why PUT /api/sessions/{session} and not a /webhooks endpoint: the WAHA build
 * we run has no webhooks sub-resource. GET /api/sessions/{session}/webhooks is
 * 404, GET /api/sessions/webhooks is 403 and GET /api/webhooks is 404. The only
 * supported way is updating the session config. That update stops, re-upserts
 * and restarts the session (SessionService.updateSession), so the status is
 * polled back to WORKING afterwards — credentials live on disk, so it
 * reconnects on its own without a new QR scan.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_FILE = path.join(root, '.waha-webhook-url.txt')

/** Events the CRM knows how to translate (see waha-webhook/route.ts). */
export const EVENTS = ['message', 'message.ack', 'message.reaction', 'poll.vote']

/** Retry policy matching the rest of the fleet's webhook config. */
const RETRIES = { policy: 'exponential', delaySeconds: 2, attempts: 15 }

/** How long to wait for the session to come back up after the PUT. */
const RECONNECT_TIMEOUT_MS = 90_000
const RECONNECT_INTERVAL_MS = 3_000

function loadEnv(...files) {
  const env = {}
  for (const file of files) {
    const full = path.join(root, file)
    if (!fs.existsSync(full)) continue
    for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (!match) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      env[match[1]] = value
    }
  }
  return env
}

function parseArgs(argv) {
  const args = { flags: new Set(), base: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--base') args.base = argv[++i] ?? null
    else if (arg.startsWith('--base=')) args.base = arg.slice('--base='.length)
    else args.flags.add(arg.replace(/^--/, ''))
  }
  return args
}

function mask(secret) {
  if (!secret) return '(missing)'
  if (secret.length <= 6) return '*'.repeat(secret.length)
  return `${secret.slice(0, 3)}${'*'.repeat(Math.min(secret.length - 5, 24))}${secret.slice(-2)}`
}

/** Mask the token inside a webhook URL, leaving the host readable. */
function maskUrl(url) {
  return String(url ?? '').replace(/token=([^&]+)/, (_, token) => {
    let decoded = token
    try {
      decoded = decodeURIComponent(token)
    } catch {
      /* keep raw */
    }
    return `token=${mask(decoded)}`
  })
}

function webhookUrl(base, secret) {
  return `${String(base).trim().replace(/\/+$/, '')}/api/whatsapp/waha-webhook?token=${encodeURIComponent(secret)}`
}

async function waha(env, method, endpoint, body) {
  const base = (env.WAHA_URL ?? '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('WAHA_URL is not set in .env.local')
  const headers = { 'Content-Type': 'application/json' }
  if (env.WAHA_API_KEY?.trim()) headers['X-Api-Key'] = env.WAHA_API_KEY.trim()
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* not JSON */
  }
  return { ok: response.ok, status: response.status, json, text }
}

/** GET /api/sessions/{session} — the only place this build exposes the webhooks. */
async function getSession(env, session) {
  const result = await waha(env, 'GET', `/api/sessions/${encodeURIComponent(session)}`)
  if (!result.ok) {
    throw new Error(
      `GET /api/sessions/${session} -> HTTP ${result.status}: ${result.text.slice(0, 300)}`,
    )
  }
  return result.json
}

function webhooksOf(sessionJson) {
  const list = sessionJson?.config?.webhooks
  return Array.isArray(list) ? list : []
}

function describeWebhook(entry) {
  const lines = [`- ${maskUrl(entry?.url)}`]
  const events = Array.isArray(entry?.events) ? entry.events.join(', ') : '(none)'
  lines.push(`  events: ${events}`)
  if (entry?.retries?.policy) {
    lines.push(
      `  retries: ${entry.retries.policy} x${entry.retries.attempts ?? '?'} every ${entry.retries.delaySeconds ?? '?'}s`,
    )
  }
  return lines.join('\n')
}

async function status(env, session) {
  const list = await waha(env, 'GET', '/api/sessions')
  if (!list.ok) {
    console.log(`WAHA /api/sessions -> HTTP ${list.status}: ${list.text.slice(0, 300)}`)
    return false
  }
  const sessions = Array.isArray(list.json) ? list.json : (list.json?.sessions ?? [])
  console.log('Sessions:')
  for (const item of sessions) {
    console.log(`- ${item.name} [${item.status}] engine=${item.engine ?? '?'}`)
  }
  console.log(`\nUsing session: ${session}`)

  const detail = await getSession(env, session)
  console.log(`status: ${detail?.status ?? '?'} | me.id: ${detail?.me?.id ?? '?'}`)
  const entries = webhooksOf(detail)
  if (!entries.length) {
    console.log('Webhooks: none configured')
    return true
  }
  console.log(`Webhooks (${entries.length}):`)
  for (const entry of entries) {
    if (!entry) continue
    console.log(describeWebhook(entry))
  }
  return true
}

/** Poll until the session is WORKING again (or give up loudly). */
async function waitForWorking(env, session, timeoutMs = RECONNECT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  let lastStatus = 'unknown'
  process.stdout.write('waiting for session to come back: ')
  while (Date.now() < deadline) {
    try {
      const detail = await getSession(env, session)
      lastStatus = detail?.status ?? 'unknown'
      if (lastStatus === 'WORKING') {
        console.log('WORKING')
        return { ok: true, status: lastStatus }
      }
    } catch (error) {
      lastStatus = `error: ${error.message}`
    }
    process.stdout.write('.')
    await new Promise((resolve) => setTimeout(resolve, RECONNECT_INTERVAL_MS))
  }
  console.log(` gave up (last status: ${lastStatus})`)
  return { ok: false, status: lastStatus }
}

function backupWebhooks(session, entries) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(root, `.waha-webhooks.backup-${stamp}.json`)
  fs.writeFileSync(file, JSON.stringify({ session, webhooks: entries }, null, 2) + '\n', {
    mode: 0o600,
  })
  return file
}

async function register(env, session, url, { append = false, dryRun = false } = {}) {
  const detail = await getSession(env, session)
  const config = detail?.config ?? {}
  const before = webhooksOf(detail)

  const ours = { url, events: EVENTS, retries: RETRIES }
  // `append` keeps the other receivers; the default replaces them. Either
  // way, any previous entry pointing at OUR endpoint is dropped so that
  // re-running the command updates its own entry instead of duplicating it.
  const kept = append
    ? before.filter((entry) => String(entry?.url ?? '') !== url)
    : []
  const after = [...kept, ours]

  console.log('\nBefore:')
  if (!before.length) console.log('- (none)')
  for (const entry of before) if (entry) console.log(describeWebhook(entry))
  console.log('\nAfter:')
  for (const entry of after) console.log(describeWebhook(entry))
  if (append) {
    console.log(`(append mode — kept ${kept.length} existing webhook(s))`)
  } else if (before.length) {
    console.log('(replace mode — previous webhook(s) removed; back up below)')
  }

  const payload = { config: { ...config, webhooks: after } }
  if (dryRun) {
    console.log('\n--dry-run: payload that would be PUT (token masked):')
    console.log(JSON.stringify(payload, (key, value) => (key === 'url' ? maskUrl(value) : value), 2))
    return true
  }

  if (before.length) {
    const file = backupWebhooks(session, before)
    console.log(`\nbackup of previous webhooks: ${path.relative(root, file)} (git-ignored)`)
  }

  let result = await waha(
    env,
    'PUT',
    `/api/sessions/${encodeURIComponent(session)}`,
    payload,
  )
  if (result.status === 400) {
    // Some builds want the name + start flag alongside the config.
    console.log('400 on {config}; retrying with {name, start, config}')
    result = await waha(env, 'PUT', `/api/sessions/${encodeURIComponent(session)}`, {
      name: session,
      start: true,
      config: payload.config,
    })
  }
  if (!result.ok) {
    console.log(`register failed -> HTTP ${result.status}: ${result.text.slice(0, 400)}`)
    return false
  }

  console.log('\nRegistered on WAHA.')
  const reconnected = await waitForWorking(env, session)
  if (!reconnected.ok) {
    console.log(
      `\nThe session is ${reconnected.status}, not WORKING. If it is SCAN_QR_CODE or` +
        ' FAILED, open the WAHA dashboard and pair the number again — the webhook is' +
        ' already saved either way.',
    )
    return false
  }
  return true
}

const env = loadEnv('.env.local', '.env')
const args = parseArgs(process.argv.slice(2))
const session = env.WAHA_SESSION?.trim() || 'default'
const secret = env.WAHA_WEBHOOK_SECRET?.trim() ?? ''
const base = (args.base ?? env.NEXT_PUBLIC_SITE_URL ?? '').trim()

if (args.flags.has('status')) {
  const ok = await status(env, session)
  process.exit(ok ? 0 : 1)
}

if (!secret) {
  console.error('WAHA_WEBHOOK_SECRET is missing in .env.local')
  process.exit(1)
}
console.log(`WAHA_WEBHOOK_SECRET: ${mask(secret)}`)

if (!base) {
  console.error(
    'No public base URL. Pass --base https://<your-public-host> or set NEXT_PUBLIC_SITE_URL.',
  )
  process.exit(1)
}

console.log(`base:   ${base}`)
console.log(`events: ${EVENTS.join(', ')}`)
console.log(`url:    ${maskUrl(webhookUrl(base, secret))}`)
if (args.flags.has('reveal')) console.log(`\nfull url:\n${webhookUrl(base, secret)}`)
if (args.flags.has('write')) {
  fs.writeFileSync(OUT_FILE, webhookUrl(base, secret) + '\n', { mode: 0o600 })
  console.log(`\nsaved to ${path.relative(root, OUT_FILE)} (git-ignored)`)
}
if (args.flags.has('register')) {
  const ok = await register(env, session, webhookUrl(base, secret), {
    append: args.flags.has('append'),
    dryRun: args.flags.has('dry-run'),
  })
  process.exit(ok ? 0 : 1)
}
