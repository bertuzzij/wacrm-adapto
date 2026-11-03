// Read-only checks against the database in SUPABASE_DB_URL
// (.env.migrate / .env.local). Never prints the URL.
//
//   node scripts/check-db-empty.mjs          # count tables in `public`
//   node scripts/check-db-empty.mjs --verify # run supabase/ci/verify-schema.sql
import { readFileSync, existsSync } from 'node:fs'
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
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  if (process.argv.includes('--verify')) {
    client.on('notice', (n) => console.log(n.message))
    await client.query(readFileSync(join(root, 'supabase', 'ci', 'verify-schema.sql'), 'utf8'))
    console.log('verify-schema.sql: OK')
  } else {
    const { rows } = await client.query(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
    )
    console.log(`public tables: ${rows[0].n}`)
  }
} catch (err) {
  console.error(`FAILED: ${err.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
