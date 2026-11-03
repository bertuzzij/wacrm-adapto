#!/usr/bin/env node
/**
 * Installs the repo's git hooks.
 *
 * Git does not track .git/hooks, so a hook committed as a file is not active
 * until someone installs it. This copies (rather than symlinks — symlinks are
 * unreliable on Windows) the hook into .git/hooks and marks it executable.
 *
 * Run automatically by `npm install` via the "prepare" script, and manually
 * with `npm run hooks:install`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hooksDir = path.join(root, '.git', 'hooks')

if (!fs.existsSync(path.join(root, '.git'))) {
  // Installed as a dependency, or the tarball was extracted without .git.
  console.log('[hooks] no .git directory — skipping')
  process.exit(0)
}

if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true })

const hookBody = `#!/bin/sh
# Installed by scripts/install-hooks.mjs — do not edit, re-run the installer.
node "$(git rev-parse --show-toplevel)/scripts/check-secrets.mjs" || exit 1
`

const target = path.join(hooksDir, 'pre-commit')
fs.writeFileSync(target, hookBody, { mode: 0o755 })
try {
  fs.chmodSync(target, 0o755)
} catch {
  // Windows: chmod is mostly a no-op, and git runs the hook via sh anyway.
}

console.log(`[hooks] installed pre-commit -> ${path.relative(root, target)}`)
