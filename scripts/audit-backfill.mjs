// Descobre QUAIS mensagens o backfill atribuiu errado.
//
// Ground truth: o WAHA nomeia o arquivo com o id da própria mensagem.
// Uma mensagem `true_<chat>_A550D417...` deve apontar para um arquivo cujo
// nome começa com `A550D417...`. Se não começar, o backfill errou nesta
// mensagem.
//
// Isto substitui o casamento por timestamp, que foi a causa do erro.
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
 * Extrai o "stem" do arquivo a partir do id da mensagem.
 *
 * Duas formas, e é fácil errar a segunda:
 *
 *   conversa individual:
 *     true_180393055678572@lid_A550D417F1E349BAAF1524B6E61700C2
 *                             ^ stem (último segmento)
 *
 *   grupo (tem o REMETENTE no fim):
 *     true_5511971415149-1593719147@g.us_3EB0EC7BE4DFF9367D8E5E_39788627423277@lid
 *                                            ^ stem (penúltimo, não o último)
 *
 * Pegar sempre o último segmento devolvia `39788627423277lid` para as de
 * grupo e fazia 3 mensagens CORRETAS serem acusadas de erradas.
 */
function stemFromMessageId(messageId) {
  if (!messageId) return null

  const parts = messageId.split('_')
  if (parts.length < 3) return null

  // Do fim para o começo: o primeiro segmento que parecer um id hex/base64
  // de arquivo (>= 8 chars, sem `@`) é o stem.
  for (let i = parts.length - 1; i >= 2; i--) {
    const candidate = parts[i].replace(/[^A-Za-z0-9]/g, '')
    if (candidate.length >= 8 && !parts[i].includes('@')) return candidate
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

const backup = JSON.parse(readFileSync('backfill-backup.json', 'utf8'))
const ids = backup.map((b) => b.messageRowId)

const { rows } = await client.query(
  `SELECT m.id, m.message_id, m.created_at, m.media_url,
          left(m.conversation_id::text,8) AS conv
   FROM messages m WHERE m.id = ANY($1::uuid[])`,
  [ids],
)

const certas = []
const erradas = []

for (const r of rows) {
  const stem = stemFromMessageId(r.message_id)
  if (!stem) {
    console.log(`  ? sem stem utilizável: ${r.message_id}`)
    continue
  }

  // O nome guardado no Storage tem o caminho do WAHA em base64, então
  // decodifico para comparar com o stem.
  const storedName = r.media_url.split('/').pop() || ''
  const b64 = /fixed_([A-Za-z0-9_-]+)\./.exec(storedName)
  let waFile = ''
  if (b64) {
    try {
      waFile = Buffer.from(b64[1], 'base64url').toString('utf8').split('/').pop()
    } catch {
      waFile = ''
    }
  }

  const bate = waFile.startsWith(stem)
  const item = {
    messageRowId: r.id,
    message_id: r.message_id,
    conv: r.conv,
    createdAt: r.created_at,
    stem,
    waFile,
    media_url: r.media_url,
    oldUrl: backup.find((x) => x.messageRowId === r.id)?.oldUrl,
  }

  if (bate) {
    certas.push(item)
  } else {
    erradas.push(item)
  }
}

console.log('=== verificação por id da mensagem ===')
console.log('CORRETAS (arquivo bate com o id):', certas.length)
console.log('ERRADAS  (arquivo não bate):    ', erradas.length)

if (erradas.length) {
  console.log('\n--- erradas ---')
  for (const e of erradas) {
    console.log(`  conv=${e.conv} ${e.createdAt.toISOString()}`)
    console.log(`    msg stem : ${e.stem}`)
    console.log(`    arquivo  : ${e.waFile || '(ilegível)'}`)
  }
}

writeFileSync('backfill-verdict.json', JSON.stringify({ certas, erradas }, null, 2), 'utf8')
console.log('\nveredito gravado em backfill-verdict.json')

await client.end()
process.exit(0)
