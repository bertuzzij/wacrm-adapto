'use client'

/**
 * Inscrição de Web Push no navegador.
 *
 * ## A diferença que importa
 *
 * `Notification.requestPermission()` só dá permissão para MOSTRAR aviso.
 * Para o aviso chegar com o app FECHADO é preciso mais: uma inscrição de
 * push no serviço do navegador (FCM / Mozilla / Apple), com as chaves
 * criptográficas, enviada para o nosso servidor guardar.
 *
 * ## Ordem obrigatória
 *
 *   1. service worker ativo  — sem ele não existe `pushManager`;
 *   2. permissão concedida    — negada, nada acontece;
 *   3. `pushManager.subscribe({ applicationServerKey })` — cria a inscrição;
 *   4. POST no servidor       — guarda endpoint + chaves.
 *
 * Inverter 1 e 3 é o erro comum: `registration.pushManager` é `undefined`
 * enquanto o worker não está ativo.
 */

// O registro do service worker e a checagem de contexto seguro moram no
// módulo de PWA — reusar evita duas noções de "worker ativo" divergindo.
import { getActiveRegistration, canUseServiceWorker } from '@/adapto/pwa/notify'

export interface PushSupport {
  supported: boolean
  /** Motivo, para a UI explicar em vez de só desabilitar. */
  reason: 'ok' | 'insecure' | 'no-service-worker' | 'no-push-api' | 'no-vapid-key'
}

/**
 * A chave pública VAPID vem embutida em build time. Sem ela, `subscribe()`
 * lança — então é checada antes de tentar.
 */
function vapidPublicKey(): string | null {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  return key && key.length > 0 ? key : null
}

export function checkPushSupport(): PushSupport {
  if (!canUseServiceWorker()) {
    return { supported: false, reason: 'insecure' }
  }
  if (!('PushManager' in window)) {
    return { supported: false, reason: 'no-push-api' }
  }
  if (!vapidPublicKey()) {
    // Instância sem VAPID configurado: o push simplesmente não existe. A
    // UI precisa dizer isso em vez de oferecer um botão que falha.
    return { supported: false, reason: 'no-vapid-key' }
  }
  if (!('serviceWorker' in navigator)) {
    return { supported: false, reason: 'no-service-worker' }
  }
  return { supported: true, reason: 'ok' }
}

/**
 * Base64url → Uint8Array, formato que `applicationServerKey` exige.
 * O `atob` devolve string binária; a conversão char a char é o caminho.
 *
 * O retorno é tipado como `Uint8Array<ArrayBuffer>` de propósito: no
 * TypeScript 6 o `Uint8Array` genérico carrega `ArrayBufferLike`, que inclui
 * `SharedArrayBuffer` — e `applicationServerKey` exige um `BufferSource`
 * apoiado em `ArrayBuffer`. O `new Uint8Array(n)` já produz esse tipo; só
 * falta declarar.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i)
  }
  return output
}

/** A inscrição existente deste navegador, se houver. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!checkPushSupport().supported) return null
  const registration = await getActiveRegistration()
  if (!registration) return null
  return registration.pushManager.getSubscription()
}

/**
 * Pede permissão, cria a inscrição e guarda no servidor.
 *
 * Devolve o erro em vez de lançar: a UI precisa mostrar o motivo real
 * ("permissão negada" é diferente de "falha ao salvar").
 */
export async function subscribeToPush(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const support = checkPushSupport()
  if (!support.supported) return { ok: false, error: support.reason }

  if (typeof Notification === 'undefined') {
    return { ok: false, error: 'no-push-api' }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, error: 'permission-denied' }
  }

  // O worker precisa estar ATIVO antes de existir pushManager.
  const registration = await getActiveRegistration()
  if (!registration) return { ok: false, error: 'no-service-worker' }

  const key = vapidPublicKey()
  if (!key) return { ok: false, error: 'no-vapid-key' }

  let subscription: PushSubscription
  try {
    subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        // Exigido por Chrome e Apple: toda entrega deve resultar em aviso
        // visível. Sem isso o navegador recusa a inscrição.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      }))
  } catch (err) {
    console.error('[push] subscribe failed:', err)
    return { ok: false, error: 'subscribe-failed' }
  }

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, error: 'incomplete-subscription' }
  }

  try {
    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent: navigator.userAgent,
      }),
    })
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null
      return { ok: false, error: data?.error ?? 'save-failed' }
    }
  } catch {
    return { ok: false, error: 'network' }
  }

  return { ok: true }
}

/** Remove a inscrição deste navegador, no servidor e localmente. */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!canUseServiceWorker()) return false

  const registration = await getActiveRegistration()
  if (!registration) return false

  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return true

  const endpoint = subscription.endpoint

  // Ordem: servidor primeiro. Se apagássemos localmente e o DELETE
  // falhasse, o servidor continuaria enviando para um endpoint morto até
  // o primeiro 410 — e o usuário acharia que desligou.
  try {
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    })
  } catch {
    return false
  }

  await subscription.unsubscribe()
  return true
}
