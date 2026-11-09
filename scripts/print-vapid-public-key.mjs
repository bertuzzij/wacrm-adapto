// Extrai a chave VAPID pública do bundle de cliente.
//
// Serve só para o teste manual de inscrição: o app lê a chave de
// `process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY` em build time, então o valor
// está literal no chunk. Este script devolve a mesma string sem imprimir a
// chave privada em lugar nenhum.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), '.next', 'static', 'chunks')
const found = []

function walk(current) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = join(current, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (!entry.name.endsWith('.js')) continue
    const source = readFileSync(full, 'utf8')
    for (const match of source.matchAll(/"([A-Za-z0-9_-]{86,90})"/g)) {
      if (match[1].startsWith('B')) found.push(match[1])
    }
  }
}

walk(dir)

if (found.length === 0) {
  console.error('Nenhuma chave VAPID no bundle. Rode `npm run build`.')
  process.exit(1)
}

// Só a pública: imprimir no stdout é seguro. A privada nunca sai do env.
console.log(found[0])
