// Remove as duplicatas de mensagem de grupo criadas em 24/11/2026.
//
// POR QUE EXISTEM
//
// A atualização do WAHA para 2026.10.1 mudou a forma do id devolvido pelo
// /api/sendText: passou de `true_<grupo>_<stanza>_<participante>` para
// `true_<grupo>_<stanza>`, e o eco do webhook continuou chegando com outro
// participante (`…@lid`). Como `messages` deduplica por
// (conversation_id, message_id), ids diferentes da MESMA mensagem geraram
// duas linhas. Medido: zero duplicatas em 119 envios até 23/11 e 10 de 10
// duplicados em 24/11.
//
// A correção no código normaliza a chave para o stanza
// (src/adapto/whatsapp-groups/message-key.ts), então nada novo duplica.
// Este script limpa o que já duplicou.
//
// QUAL LINHA FICA
//
// A do ENVIO (tem `sender_id`), que é a que o CRM criou e a que a UI usa
// para casar o balão otimista. Quando as duas têm o mesmo conteúdo, a do
// envio tem o texto puro e a do eco tem a assinatura `*Nome:*` aplicada
// no envio — manter o envio evita mostrar o nome repetido no balão.
//
//   node scripts/fix-group-message-duplicates.mjs            # dry-run
//   node scripts/fix-group-message-duplicates.mjs --apply    # apaga
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let url = process.env.SUPABASE_DB_URL
for (const name of ['.env.migrate', '.env.local']) {
  if (url) break
  const file = join(root, name)
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*SUPABASE_DB_URL\s*=\s*(.*?)\s*$/)
    if (m) url = m[1].replace(/^['"]|['"]$/g, '')
  }
}
if (!url) {
  console.error('SUPABASE_DB_URL nao configurada (--env.migrate ou .env.local)')
  process.exit(1)
}

const apply = process.argv.includes('--apply')

// Um grupo tem um stanza por mensagem. Duas linhas com o mesmo stanza e o
// mesmo conversation_id sao a mesma mensagem gravada duas vezes.
const DUPLICATES_SQL = `
  select split_part(message_id, '_', 3) as stanza,
         conversation_id,
         array_agg(id order by (sender_id is not null) desc, created_at asc) as ids,
         array_agg(coalesce(status, '?') order by (sender_id is not null) desc, created_at asc) as statuses,
         array_agg((sender_id is not null) order by (sender_id is not null) desc, created_at asc) as is_send,
         min(created_at) as primeira
  from messages
  where message_id like 'true_%@g.us_%'
  group by 1, 2
  having count(*) > 1
  order by primeira`

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const { rows } = await client.query(DUPLICATES_SQL)
  if (rows.length === 0) {
    console.log('nenhuma duplicata encontrada')
  } else {
    console.log(`${rows.length} stanza(s) duplicado(s):\n`)
    let toDelete = 0
    for (const row of rows) {
      const keepIdx = row.is_send.indexOf(true) === -1 ? 0 : row.is_send.indexOf(true)
      const keep = row.ids[keepIdx]
      const drop = row.ids.filter((id) => id !== keep)
      toDelete += drop.length
      console.log(
        `  ${String(row.stanza).slice(0, 18)}  linhas=${row.ids.length}  ` +
          `mantem=${row.statuses[keepIdx]}  apaga=${drop.map((_, i) => row.statuses[keepIdx === 0 ? i + 1 : i] ?? '?').join(',')}`,
      )
    }
    console.log(`\ntotal a apagar: ${toDelete} linha(s)`)

    if (apply) {
      const idsToDelete = rows.flatMap((row) => {
        const keepIdx = row.is_send.indexOf(true) === -1 ? 0 : row.is_send.indexOf(true)
        return row.ids.filter((_, i) => i !== keepIdx)
      })
      const { rowCount } = await client.query('delete from messages where id = any($1::uuid[])', [
        idsToDelete,
      ])
      console.log(`apagadas: ${rowCount}`)
    } else {
      console.log('\n(dry-run — rode com --apply para apagar)')
    }
  }
} catch (err) {
  console.error(`FALHOU: ${err.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
