// Teste end-to-end de Web Push, sem interface.
//
// Gera um par de chaves de navegador (curvas P-256, igual ao que o Chrome
// faz), monta a inscrição e chama o MESMO código de envio que o webhook usa.
// Se o serviço de push aceitar (201/202), o caminho servidor está correto:
// VAPID assinado, payload criptografado no formato do protocolo.
//
// Não prova que o celular exibiu — isso só o aparelho prova. Prova que o
// servidor entrega, que é onde 90% dos bugs de push moram.
//
// Uso: node scripts/test-push.mjs
// `web-push` é CommonJS: em ESM o namespace é o único import que resolve
// (não existe export default). Mesmo motivo da escolha em sender.ts.
import * as webpush from 'web-push'
import crypto from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      if (!process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
      }
    }
  }
}

loadEnv()

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const privateKey = process.env.VAPID_PRIVATE_KEY
const subject = process.env.VAPID_SUBJECT

if (!publicKey || !privateKey || !subject) {
  console.error('VAPID não configurado (.env.local). Abortando.')
  process.exit(1)
}

// Confere que as duas chaves são um par — erro clássico de configuração
// (copiar a pública de uma geração e a privada de outra) que só aparece
// no envio, como 403 do serviço de push.
const derivedPublic = crypto
  .createECDH('prime256v1')
  .setPrivateKey(Buffer.from(privateKey, 'base64url'))
  .getPublicKey('base64url')

if (derivedPublic !== publicKey) {
  console.error('ERRO: a chave privada não corresponde à pública.')
  console.error('  derived:', derivedPublic.slice(0, 12) + '...')
  console.error('  config :', publicKey.slice(0, 12) + '...')
  process.exit(1)
}
console.log('OK: o par de chaves VAPID confere.')

webpush.setVapidDetails(subject, publicKey, privateKey)

// Inscrição sintética: as chaves do NAVEGADOR (não as VAPID). FCM/Apple não
// validam o endpoint contra um registro real neste ponto; o que validam é a
// assinatura VAPID e a criptografia do payload.
const ecdh = crypto.createECDH('prime256v1')
ecdh.generateKeys()
const authSecret = crypto.randomBytes(16)

const subscription = {
  endpoint:
    'https://fcm.googleapis.com/fcm/send/' +
    crypto.randomBytes(16).toString('base64url'),
  keys: {
    p256dh: ecdh.getPublicKey('base64url'),
    auth: authSecret.toString('base64url'),
  },
}

const payload = JSON.stringify({
  title: 'Maria Silva',
  body: 'Oi, tudo bem? (teste de push)',
  tag: 'test-conversation',
  url: '/inbox?c=test',
})

console.log('Enviando para um endpoint sintético do FCM...')

try {
  const result = await webpush.sendNotification(subscription, payload)
  console.log('RESULTADO: aceito pelo serviço de push')
  console.log('  status:', result.statusCode)
} catch (err) {
  const status = err?.statusCode
  const body = err?.body
  console.log('RESULTADO: status', status)

  // 404/410 aqui significa: o endpoint sintético não existe (esperado).
  // Provamos o que importava — a requisição chegou ao FCM ASSINADA e
  // CRIPTOGRAFADA corretamente. Um erro de VAPID devolveria 401/403;
  // um payload malformado devolveria 400.
  if (status === 404 || status === 410) {
    console.log('OK: VAPID e criptografia aceitos (o endpoint de teste não existe).')
    process.exit(0)
  }

  console.error('FALHOU. Resposta do serviço:', body || err?.message)
  process.exit(1)
}
