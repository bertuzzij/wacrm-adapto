#!/usr/bin/env node
/**
 * Installs the repo's git hooks.
 *
 * Git does not track .git/hooks, so a hook committed as a file is not active
 * until someone installs it. This copies (rather than symlinks — symlinks are
 * unreliable on Windows) the hook into .git/hooks and marks it executable.
 *
 * Runs from `npm install` via the "prepare" script, and manually with
 * `npm run hooks:install`.
 *
 * IMPORTANT — this script must never be able to fail a build.
 *
 * `npm ci` runs "prepare" in contexts where there is no repository at all:
 * the Dockerfile's `deps` stage copies only package.json and
 * package-lock.json, so this file is not even present there, and CI runners
 * check out shallow or without .git. A non-zero exit in any of those turns
 * into a red build for a step that is only housekeeping. Every failure path
 * below logs and returns 0.
 *
 * Set SKIP_HOOKS=1 to skip outright.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function skip(reason) {
  console.log(`[hooks] skipped — ${reason}`)
  process.exit(0)
}

if (process.env.SKIP_HOOKS === '1') skip('SKIP_HOOKS is set')

// `import.meta.url` is the only path source that works here: `process.cwd()`
// may be the package root under `npm ci`, which is exactly the Docker case.
let root
try {
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
} catch {
  skip('could not resolve this script location')
}

const gitDir = path.join(root, '.git')
if (!fs.existsSync(gitDir)) {
  skip('no .git directory (installing as a dependency, or a build context)')
}

// A .git that is a file points at the real directory (worktrees, submodules).
let hooksDir = path.join(gitDir, 'hooks')
try {
  const stat = fs.statSync(gitDir)
  if (stat.isFile()) {
    const pointer = fs.readFileSync(gitDir, 'utf8').trim()
    const match = /^gitdir:\s*(.+)$/.exec(pointer)
    if (!match) skip('.git is a file without a gitdir pointer')
    const resolved = path.resolve(root, match[1])
    hooksDir = path.join(resolved, 'hooks')
  }
} catch {
  skip('could not inspect .git')
}

try {
  if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true })
} catch {
  skip(`could not create ${hooksDir}`)
}

const hookBody = `#!/bin/sh
# Installed by scripts/install-hooks.mjs — do not edit, re-run the installer.
node "$(git rev-parse --show-toplevel)/scripts/check-secrets.mjs" || exit 1
`

const target = path.join(hooksDir, 'pre-commit')
try {
  fs.writeFileSync(target, hookBody, { mode: 0o755 })
  fs.chmodSync(target, 0o755)
} catch {
  // Windows: chmod is mostly a no-op, and git runs the hook via sh anyway.
  // A read-only hooks dir is not worth failing an install over.
}

console.log(`[hooks] installed pre-commit -> ${path.relative(root, target)}`)
