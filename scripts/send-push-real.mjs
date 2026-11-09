// Envia um push REAL para uma inscrição real, obtida de um navegador.
//
// É o teste que fecha a cadeia: chave VAPID do servidor → criptografia →
// FCM → service worker. Se o FCM responder 201, a mensagem foi aceita para
// entrega naquele endpoint, que é exatamente o que acontece em produção
// quando chega mensagem de cliente.
//
// Uso: node scripts/send-push-real.mjs <arquivo-com-subscription.json>
import * as webpush from 'web-push'
import { readFileSync, existsSync } from 'node:fs'

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
      }
    }
  }
}

loadEnv()

const subFile = process.argv[2]
if (!subFile || !existsSync(subFile)) {
  console.error('Passe o caminho do JSON da inscrição.')
  process.exit(1)
}

const subscription = JSON.parse(readFileSync(subFile, 'utf8'))

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
)

const payload = JSON.stringify({
  title: 'Maria Silva',
  body: 'Teste de push — chegou com o app fechado?',
  tag: 'e2e-test',
  url: '/inbox?c=e2e',
})

console.log('Enviando push real para', new URL(subscription.endpoint).host)

try {
  const result = await webpush.sendNotification(subscription, payload)
  console.log('ENTREGUE. status:', result.statusCode)
  console.log('O service worker deve exibir o aviso agora.')
} catch (err) {
  console.error('FALHOU. status:', err?.statusCode)
  console.error('resposta:', err?.body || err?.message)
  process.exit(1)
}
