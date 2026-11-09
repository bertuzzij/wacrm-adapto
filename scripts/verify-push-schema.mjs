// Verifica o estado real de push_subscriptions no banco.
//
// Lê o catálogo do Postgres (RLS, políticas, colunas) em vez de confiar no
// arquivo de migração: o que importa é o que o banco aplicou. Nunca imprime
// a string de conexão.
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

const url = readDbUrl()
if (!url) {
  console.error('SUPABASE_DB_URL ausente.')
  process.exit(1)
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()

const { rows: cols } = await client.query(`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'push_subscriptions'
  ORDER BY ordinal_position
`)
console.log('--- colunas ---')
for (const c of cols) console.log(`  ${c.column_name.padEnd(14)} ${c.data_type.padEnd(28)} null=${c.is_nullable}`)

const { rows: rls } = await client.query(`
  SELECT relrowsecurity FROM pg_class WHERE relname = 'push_subscriptions'
`)
console.log('\n--- RLS habilitado:', rls[0]?.relrowsecurity === true, '---')

const { rows: policies } = await client.query(`
  SELECT policyname, cmd, qual, with_check
  FROM pg_policies WHERE tablename = 'push_subscriptions'
  ORDER BY policyname
`)
console.log('\n--- políticas ---')
for (const p of policies) {
  const condition = p.with_check || p.qual || ''
  const usesUserId = /user_id\s*=\s*auth\.uid\(\)/.test(condition)
  const usesWrongId = /profiles\s+where\s+id\s*=\s*auth\.uid\(\)/.test(condition)
  console.log(`  ${p.policyname} [${p.cmd}]`)
  console.log(`      user_id correto: ${usesUserId} | profiles.id ERRADO: ${usesWrongId}`)
}

const { rows: idx } = await client.query(`
  SELECT indexname FROM pg_indexes WHERE tablename = 'push_subscriptions'
`)
console.log('\n--- índices ---')
for (const i of idx) console.log(`  ${i.indexname}`)

await client.end()
