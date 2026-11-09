// Planeja o backfill de mídias colididas, casando por ID DA MENSAGEM.
//
// ## Por que por id e não por timestamp
//
// A primeira versão casava por timestamp com tolerância de ±2s. Em
// conversas com fotos em sequência isso atribuiu o arquivo de uma mensagem
// a outra — recriando exatamente o problema que o backfill deveria
// consertar. 2 das 23 correções saíram trocadas.
//
// O WAHA nomeia o arquivo com o stem do id da mensagem, então o casamento
// exato é possível:
//
//   id  true_180393055678572@lid_A550D417F1E349BAAF1524B6E61700C2
//   url .../api/files/<sessão>/A550D417F1E349BAAF1524B6E61700C2.jpeg
//
// Em grupo o id tem o remetente no fim, então o stem é o PENÚLTIMO
// segmento — não o último. Ver `stemFromMessageId`.
//
// Uso: node scripts/plan-media-backfill.mjs
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import pg from 'pg'

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
      }
    }
  }
}
loadEnv()

/**
 * O stem do arquivo a partir do id da mensagem.
 *
 *   true_180393055678572@lid_A550D417...             -> A550D417...  (último)
 *   true_<chat>@g.us_3EB0EC7B..._39788627423277@lid  -> 3EB0EC7B...  (penúltimo)
 *
 * Grupos acrescentam o remetente ao fim; pegar sempre o último segmento
 * devolveria `<digits>lid` e nenhum arquivo casaria.
 */
export function stemFromMessageId(messageId) {
  if (!messageId) return null
  const parts = messageId.split('_')
  if (parts.length < 3) return null

  for (let i = parts.length - 1; i >= 2; i--) {
    if (parts[i].includes('@')) continue
    const candidate = parts[i].replace(/[^A-Za-z0-9]/g, '')
    if (candidate.length >= 8) return candidate
  }
  return null
}

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 30_000,
  connectionTimeoutMillis: 15_000,
})
await client.connect()

const headers = { 'X-Api-Key': process.env.WAHA_API_KEY }

async function wahaMessages(chatId) {
  const url = `${process.env.WAHA_URL}/api/messages?session=${process.env.WAHA_SESSION}&chatId=${encodeURIComponent(chatId)}&limit=100`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(60_000),
      })
      if (res.ok) return await res.json()
      if (res.status < 500) return []
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return []
}

try {
  // Mensagens cujo media_url é compartilhado.
  const { rows: affected } = await client.query(`
    WITH shared AS (
      SELECT media_url
      FROM messages
      WHERE media_url IS NOT NULL AND media_url LIKE '%/chat-media/%'
      GROUP BY media_url
      HAVING COUNT(DISTINCT conversation_id) > 1 OR COUNT(*) > 1
    )
    SELECT m.id, m.message_id, m.content_type, m.created_at, m.media_url,
           c.phone, c.wa_user_id
    FROM messages m
    JOIN shared s ON s.media_url = m.media_url
    JOIN conversations cv ON cv.id = m.conversation_id
    JOIN contacts c ON c.id = cv.contact_id
    ORDER BY m.created_at
  `)

  /**
   * O JID com que o WAHA conhece a conversa.
   *
   * Para grupo ele mora em `contacts.phone` com prefixo `group:` —
   * `wa_user_id` é null. Ignorar isso fazia o plano usar um chatId de
   * contato inventado e não achar mídia nenhuma dos grupos.
   */
  function chatOf(m) {
    const fromPhone = (m.phone || '').trim()
    if (fromPhone.startsWith('group:')) {
      const jid = fromPhone.slice('group:'.length)
      if (jid.includes('@')) return jid
    }
    const raw = (m.wa_user_id || '').trim().replace(/^group:/, '')
    if (raw.includes('@')) return raw
    const phone = fromPhone.replace(/\D/g, '')
    return phone ? `${phone}@c.us` : null
  }

  const byChat = new Map()
  for (const m of affected) {
    const chat = chatOf(m)
    if (!chat) continue
    if (!byChat.has(chat)) byChat.set(chat, [])
    byChat.get(chat).push(m)
  }

  const plano = []
  const semMatch = []

  for (const [chat, msgs] of byChat) {
    const list = await wahaMessages(chat)
    const media = (Array.isArray(list) ? list : []).filter((w) => w.media?.url)

    // Índice por stem: é o casamento exato.
    const byStem = new Map()
    for (const w of media) {
      const stem = new URL(w.media.url).pathname.split('/').pop()?.split('.')[0]
      if (stem) byStem.set(stem.toUpperCase(), w)
    }

    console.log(`  ${chat}: ${msgs.length} no banco, ${media.length} no WAHA`)

    for (const m of msgs) {
      const stem = stemFromMessageId(m.message_id)
      const hit = stem ? byStem.get(stem.toUpperCase()) : null

      if (!hit) {
        semMatch.push(m)
        continue
      }

      const path = new URL(hit.media.url).pathname
      plano.push({
        messageRowId: m.id,
        content_type: m.content_type,
        createdAt: m.created_at,
        oldUrl: m.media_url,
        waPath: path,
        stem,
        matchedBy: 'message-id',
      })
    }
  }

  console.log('\nafetadas:', affected.length)
  console.log('casadas por ID:', plano.length)
  console.log('sem correspondência:', semMatch.length)

  const paths = plano.map((p) => p.waPath)
  console.log('caminhos distintos:', new Set(paths).size, 'de', paths.length)

  writeFileSync('backfill-plan.json', JSON.stringify(plano, null, 2), 'utf8')
  console.log('plano gravado: backfill-plan.json')
} finally {
  await client.end()
}
process.exit(0)
