#!/usr/bin/env node
/**
 * Pre-commit secret scanner.
 *
 * Blocks the commit when a staged file looks like it carries a real
 * credential. Two layers:
 *
 *   1. Known-value check — reads the local .env files (which are
 *      git-ignored) and refuses to commit if ANY of those literal values
 *      appears in the staged content. This is the check that actually
 *      matters: it catches the case where you paste a real key into a
 *      test fixture or a doc, which no pattern ever catches.
 *   2. Pattern check — high-confidence shapes (Supabase/Cloudflare JWTs,
 *      AWS keys, GitHub tokens, private-key blocks, credentials inside a
 *      connection string, long random-looking assignments).
 *
 * Deliberately NOT flagged (all verified harmless in this repo):
 *   - `ENCRYPTION_KEY: '000...0'` and similar test fixtures
 *   - placeholder tokens such as `wacrm_live_xxxxx`, `ci-dummy-*`
 *   - minified vendor bundles under public/ (false positives on random
 *     substrings; they are third-party code, not our secrets)
 *
 * Usage: wired up as a pre-commit hook by `npm run hooks:install`.
 * Bypass a false positive with `git commit --no-verify` — but read the
 * output first; the known-value check is right far more often than not.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const RED = '\u001b[31m'
const YELLOW = '\u001b[33m'
const DIM = '\u001b[2m'
const RESET = '\u001b[0m'

/** Files whose content we never scan: third-party, binary, lockfiles. */
const SKIP_PATHS = [
  /^public\/opus\//,
  /^package-lock\.json$/,
  /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp4|mp3|pdf|zip|gz|map)$/i,
]

/** Placeholder shapes that are clearly not real secrets. */
const PLACEHOLDER = [
  /^(x{4,}|0{16,}|1{16,}|-+|changeme|placeholder|dummy|example|todo)$/i,
  /^ci-dummy/,
  /^(your|my)[-_]/i,
  /_here$/i,
  /^sk-xxxx/i,
  /wacrm_live_x+$/i,
]

const PATTERNS = [
  { name: 'Supabase/anon JWT', re: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}/g },
  { name: 'Cloudflare tunnel token', re: /eyJhIjoi[A-Za-z0-9_-]{20,}/g },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: 'OpenAI key', re: /\bsk-[A-Za-z0-9]{40,}\b/g },
  { name: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: 'Password in connection string', re: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis):\/\/[^\s:/@]+:(?!\*)[^\s@]{6,}@/g },
  // KEY=<long value> in a non-example file: the shape of a real .env line.
  { name: 'Hardcoded credential assignment', re: /\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*[:=]\s*["']?([A-Za-z0-9_\-+/.=]{24,})["']?/g },
]

// ---------------------------------------------------------------------------
// Personal / infrastructure data
//
// A secret scanner catches credentials. It does not catch the things that
// leak just as permanently and embarrass differently: a phone number in a
// test fixture, your home IP in a doc, the internal hostname of your
// homelab. Every literal below came from this fork's own env at some point.
//
// These are exact strings, not shapes: a real number and a made-up one look
// identical, so only the specific ones that belong to this operator are
// matched. Keep this list in sync when infrastructure changes.
// ---------------------------------------------------------------------------
const PERSONAL_PATTERNS = [
  { name: 'operator domain', re: /conectaja\.online/gi },
  { name: 'operator VPS/WAHA host', re: /(whadmin|auton)\./gi },
  { name: 'operator phone number', re: /\b5516(997541096|994646393)\b/g },
  { name: 'operator Supabase project ref', re: /jktdevacmcfviaizkepz/gi },
  { name: 'homelab hostname', re: /\bbrtznote\b/gi },
  { name: 'private LAN address', re: /\b192\.168\.\d{1,3}\.\d{1,3}\b/g },
  { name: 'Cloudflare tunnel id', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g },
  { name: 'operator name/email', re: /\b(?:jhonatan|jbertuzzi|bertuzzi|suporte\s*j?bertuzzi|jhonatanbertuzzi|suportejbertuzzi)\b/gi },
]

/**
 * Paths where the personal patterns are legitimately expected: the docs
 * that describe this deployment, and the tests that assert the redaction
 * itself. Everything else must stay clean.
 */
const PERSONAL_PATTERN_ALLOWLIST = [/^docs\/seguranca-fork\.md$/, /^scripts\/check-secrets\.mjs$/]


function isPlaceholder(value) {
  return PLACEHOLDER.some((p) => p.test(value))
}

/** Literal values from the local, git-ignored env files. */
function localSecretValues() {
  const values = new Map()
  for (const name of ['.env.local', '.env']) {
    const file = path.join(root, name)
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (!match) continue
      const key = match[1]
      const value = match[2].trim().replace(/^["']|["']$/g, '')
      // Only values long enough to be meaningful, and only ones that look
      // like credentials rather than config (URLs and locales are fine to
      // see in docs, and flagging them creates noise that trains people to
      // ignore the hook).
      if (value.length < 16) continue
      if (/^https?:\/\//i.test(value)) continue
      if (/^(en|pt|es|ko)$/i.test(value)) continue
      if (isPlaceholder(value)) continue
      values.set(key, value)
    }
  }
  return values
}

function stagedFiles() {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    cwd: root,
    encoding: 'utf8',
  })
  return out.split('\n').map((s) => s.trim()).filter(Boolean)
}

const secrets = localSecretValues()
const files = stagedFiles().filter((f) => !SKIP_PATHS.some((re) => re.test(f)))

const problems = []
for (const file of files) {
  let content
  try {
    content = fs.readFileSync(path.join(root, file), 'utf8')
  } catch {
    continue // deleted or unreadable — nothing to scan
  }

  // Layer 1: does a real local secret value appear verbatim?
  for (const [key, value] of secrets) {
    if (content.includes(value)) {
      problems.push({
        file,
        kind: `value of ${key} (from your local .env)`,
        // Print no part of the secret — not even a prefix. The variable name
        // and the file are enough to find it, and a masked value still ends
        // up in scrollback and CI logs.
        sample: `(${value.length} chars)`,
      })
    }
  }

  // Layer 2: high-confidence shapes.
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0
    let match
    while ((match = re.exec(content)) !== null) {
      const captured = match[1] ?? match[0]
      if (isPlaceholder(captured.trim())) continue
      problems.push({
        file,
        kind: name,
        sample: `«${captured.slice(0, 4)}…» (${captured.length} chars)`,
      })
      break // one report per pattern per file is enough
    }
  }

  // Layer 3: this operator's own identifiers. Skipped for the few files
  // that exist to document the deployment or the redaction rules.
  if (!PERSONAL_PATTERN_ALLOWLIST.some((re) => re.test(file))) {
    for (const { name, re } of PERSONAL_PATTERNS) {
      re.lastIndex = 0
      const match = re.exec(content)
      if (match) {
        problems.push({
          file,
          kind: `${name} — this is your data, replace it with a fictitious value`,
          sample: `«${match[0].slice(0, 3)}…»`,
        })
      }
    }
  }
}

if (problems.length === 0) process.exit(0)

console.error(`${RED}✖ commit blocked — possible secret in the staged changes${RESET}\n`)
for (const p of problems) {
  console.error(`  ${YELLOW}${p.file}${RESET}`)
  console.error(`    ${p.kind} ${DIM}${p.sample}${RESET}`)
}
console.error(
  `\n${DIM}Nothing was committed. Options:${RESET}\n` +
    `  1. Remove the value and read it from an env var instead.\n` +
    `  2. If the file is not meant to be tracked: git rm --cached <file>, add it to .gitignore.\n` +
    `  3. If it is a false positive: git commit --no-verify  (then consider trusting this file in scripts/check-secrets.mjs)\n`,
)
process.exit(1)
