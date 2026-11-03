// Applies supabase/migrations/*.sql, in filename order, to a remote
// Postgres (e.g. a hosted Supabase project).
//
// The connection string is read from SUPABASE_DB_URL, either from the
// process environment or from a git-ignored `.env.migrate` / `.env.local`
// file in the project root. It is never printed.
//
//   node scripts/apply-migrations.mjs --dry-run   # list what would run
//   node scripts/apply-migrations.mjs             # apply pending files
//
// Applied versions are recorded in supabase_migrations.schema_migrations,
// the same table the Supabase CLI uses, so `supabase db push` later sees
// them as already applied. Each file runs in its own transaction.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')

function readDbUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL
  for (const name of ['.env.migrate', '.env.local']) {
    const file = join(root, name)
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*SUPABASE_DB_URL\s*=\s*(.*?)\s*$/)
      if (m) return m[1].replace(/^['"]|['"]$/g, '')
    }
  }
  return null
}

const url = readDbUrl()
if (!url) {
  console.error('SUPABASE_DB_URL not found (env var or .env.migrate).')
  process.exit(1)
}

const dir = join(root, 'supabase', 'migrations')
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})

try {
  await client.connect()
} catch (err) {
  // err.message can contain the host; never the password.
  console.error(`Could not connect: ${err.code ?? ''} ${err.message}`)
  process.exit(1)
}

try {
  await client.query('create schema if not exists supabase_migrations')
  await client.query(`
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    )`)
  const { rows } = await client.query(
    'select version from supabase_migrations.schema_migrations',
  )
  const applied = new Set(rows.map((r) => r.version))

  let ran = 0
  for (const file of files) {
    const [version, ...rest] = file.replace(/\.sql$/, '').split('_')
    const name = rest.join('_')
    if (applied.has(version)) continue
    if (dryRun) {
      console.log(`would apply  ${file}`)
      ran++
      continue
    }
    const sql = readFileSync(join(dir, file), 'utf8')
    try {
      await client.query('begin')
      await client.query(sql)
      await client.query(
        'insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)',
        [version, name, [sql]],
      )
      await client.query('commit')
      console.log(`applied      ${file}`)
      ran++
    } catch (err) {
      await client.query('rollback').catch(() => {})
      console.error(`FAILED       ${file}: ${err.message}`)
      process.exitCode = 1
      break
    }
  }
  console.log(
    ran === 0
      ? 'Nothing to do: database is up to date.'
      : `${dryRun ? 'Pending' : 'Applied'}: ${ran} migration(s).`,
  )
} finally {
  await client.end()
}
