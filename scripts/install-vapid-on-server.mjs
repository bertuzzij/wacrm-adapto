// Grava as variáveis VAPID no .env.local do servidor.
//
// Roda NO HOMELAB (via stdin). Lê o bloco VAPID do stdin e acrescenta ao
// .env.local, sem imprimir os valores. Idempotente: se as chaves já estiverem
// lá, não duplica.
//
// Cuidado com a rotação: trocar as chaves invalida todas as inscrições
// existentes. Por isso o script recusa sobrescrever uma chave diferente da
// que já está no arquivo — para trocar de propósito, remova as linhas antes.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const ENV = '/home/bertuzzij/wacrm/.env.local'

let input = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) input += chunk

const parsed = {}
for (const line of input.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
  if (m) parsed[m[1]] = m[2]
}

const required = ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']
const missing = required.filter((k) => !parsed[k])
if (missing.length > 0) {
  console.error('Faltando: ' + missing.join(', '))
  process.exit(1)
}

if (!existsSync(ENV)) {
  console.error('Não achei ' + ENV)
  process.exit(1)
}

let content = readFileSync(ENV, 'utf8')
let changed = false

for (const key of required) {
  const value = parsed[key]
  const existing = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm').exec(content)

  if (existing) {
    if (existing[1].trim() === value) {
      console.log(`${key}: já presente e igual`)
      continue
    }
    // Chave diferente = rotação. Recusa por segurança.
    console.error(
      `${key}: já existe com valor DIFERENTE. Trocar invalida todas as ` +
        `inscrições existentes. Remova a linha e rode de novo se for intencional.`,
    )
    process.exit(2)
  }

  content += `\n${key}=${value}`
  changed = true
  console.log(`${key}: gravada`)
}

if (changed) {
  if (!content.endsWith('\n')) content += '\n'
  writeFileSync(ENV, content, 'utf8')
  console.log('arquivo atualizado')
} else {
  console.log('nada a fazer')
}
