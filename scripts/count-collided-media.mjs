// Quantas mensagens JÁ GRAVADAS estão com o caminho colidido?
//
// A correção vale para mensagens novas. As antigas apontam para objetos que
// foram sobrescritos no Storage — os bytes originais não existem mais lá.
// Este script mede o alcance para decidir se vale um backfill.
import { readFileSync, existsSync } from 'node:fs'
import pg from 'pg'

function readDbUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL
  for (const name of ['.env.migrate', '.env.local']) {
    if (!existsSync(name)) continue
    for (const line of readFileSync(name, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*SUPABASE_DB_URL\s*=\s*(.*?)\s*$/)
      if (m) return m[1].replace(/^['"]|['"]$/g, '')
    }
  }
  return null
}

const client = new pg.Client({
  connectionString: readDbUrl(),
  ssl: { rejectUnauthorized: false },
})
await client.connect()

// Um media_url "colidido" é o que tem o nome truncado em 40: no Storage
// isso aparece como `waha_` seguido de base64 SEM o final do nome do arquivo.
// Sinal prático: mais de uma mensagem apontando para o mesmo objeto.
const { rows } = await client.query(`
  SELECT media_url,
         COUNT(*)::int AS mensagens,
         COUNT(DISTINCT conversation_id)::int AS conversas
  FROM messages
  WHERE media_url IS NOT NULL AND media_url LIKE '%/chat-media/%'
  GROUP BY media_url
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC
`)

console.log('=== objetos compartilhados por várias mensagens ===')
let totalAfetadas = 0
for (const r of rows) {
  const name = r.media_url.split('/').pop()
  console.log(`  ${r.mensagens}x em ${r.conversas} conversa(s): ${name}`)
  totalAfetadas += r.mensagens
}
console.log('\nobjetos colididos:', rows.length)
console.log('mensagens afetadas:', totalAfetadas)

const { rows: tot } = await client.query(`
  SELECT COUNT(*)::int AS n FROM messages
  WHERE media_url IS NOT NULL AND media_url LIKE '%/chat-media/%'
`)
console.log('total de mensagens com mídia espelhada:', tot[0].n)

if (totalAfetadas > 0) {
  console.log(
    '\nEstas conversas precisam que o mirror rode de novo — os bytes\n' +
      'originais foram sobrescritos. O proxy ainda alcança a mídia no WAHA,\n' +
      'então um backfill por mensagem recupera o conteúdo certo.',
  )
}

await client.end()
