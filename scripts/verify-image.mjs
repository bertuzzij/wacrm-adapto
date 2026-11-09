// Confere, DENTRO da imagem construída, que o pacote de PWA/push está
// completo. Roda no container: docker run --rm --entrypoint node wacrm-app
const fs = require('fs')
const path = require('path')

let chunksWithKey = 0
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (!entry.name.endsWith('.js')) continue
    const source = fs.readFileSync(full, 'utf8')
    // Chave VAPID pública: base64url longa começando com B.
    if (/"B[A-Za-z0-9_-]{85,88}"/.test(source)) chunksWithKey++
  }
}
walk('/app/.next/static/chunks')

const sw = fs.readFileSync('/app/public/sw.js', 'utf8')
const manifestFiles = ['/app/.next/server/app/manifest.webmanifest.body']

console.log('chunks com chave VAPID :', chunksWithKey, chunksWithKey > 0 ? 'OK' : 'FALTANDO')
console.log('sw com renotify        :', sw.includes('renotify: true') ? 'OK' : 'FALTANDO')
console.log('sw referencia badge    :', sw.includes('badge-96.png') ? 'OK' : 'FALTANDO')
console.log('sw version             :', (sw.match(/CACHE_VERSION = "v\d+"/) || ['?'])[0])

for (const icon of [
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'badge-96.png',
]) {
  const p = `/app/public/icons/${icon}`
  console.log(`icone ${icon.padEnd(24)}:`, fs.existsSync(p) ? 'OK' : 'FALTANDO')
}

console.log('apple-icon no app      :', fs.existsSync('/app/.next/server/app/apple-icon.png.body') || fs.existsSync('/app/.next/server/app/apple-icon.png') ? 'OK' : 'ver no static')
