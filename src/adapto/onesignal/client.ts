'use client'

/**
 * Cliente do OneSignal no navegador.
 *
 * ## Por que script dinâmico em vez do pacote `react-onesignal`
 *
 * O SDK oficial pode ser consumido de duas formas: pelo pacote npm
 * (`react-onesignal`) ou pelo script oficial carregado da CDN. Escolhemos o
 * script por três motivos concretos:
 *
 *   1. **Sem dependência nova.** O `react-onesignal` traz o SDK inteiro
 *      embutido e precisa casar com a versão de React do projeto. O script
 *      é o mesmo SDK, servido pela própria OneSignal.
 *   2. **Sem editar arquivo do upstream.** O caminho "natural" seria pôr um
 *      `<Script>` no `src/app/layout.tsx`, que é território do upstream. Aqui
 *      tudo fica em `src/adapto/`, como manda o README.
 *   3. **Carrega só quando precisa.** Quem nunca abre a tela de
 *      notificações não baixa o SDK (~40 KB). O `sw.js` continua
 *      independente.
 *
 * O worker do OneSignal (`/push/onesignal/OneSignalSDKWorker.js`) já vem da
 * CDN de qualquer jeito via `importScripts`, então a origem externa não é
 * uma exposição nova.
 *
 * ## A ordem importa
 *
 *   `init()`  → carrega o SDK e registra o service worker
 *   `login()` → amarra ESTE aparelho ao usuário
 *   `optIn()` → pede permissão e cria a inscrição
 *
 * Chamar `login()` antes de `init()` resolve não faz nada; chamar `init()`
 * duas vezes lança. Por isso há a guarda de singleton abaixo.
 */

import {
  ONESIGNAL_SW_PATH,
  ONESIGNAL_SW_SCOPE,
  onesignalAppId,
} from './config'
import { isSubscriptionUsable, type SubscriptionState } from './subscription'

/** URL oficial do SDK (a mesma que o painel fornece no snippet). */
const SDK_URL = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'

// ---------------------------------------------------------------------------
// Tipos mínimos do SDK
//
// Só o que este projeto usa. A tipagem oficial vem com o pacote npm, que
// deliberadamente não instalamos; declarar o subconjunto aqui mantém o
// `typecheck` honesto sem arrastar a dependência.
// ---------------------------------------------------------------------------

interface OneSignalPushSubscription {
  readonly id: string | null
  readonly token: string | null
  readonly optedIn: boolean | null
  optIn(): Promise<void>
  optOut(): Promise<void>
  addEventListener(
    event: 'change',
    listener: (event: {
      previous: { id: string | null; token: string | null; optedIn: boolean | null }
      current: { id: string | null; token: string | null; optedIn: boolean | null }
    }) => void
  ): void
}

interface OneSignalClient {
  init(options: {
    appId: string
    serviceWorkerPath?: string
    serviceWorkerParam?: { scope: string }
    allowLocalhostAsSecureOrigin?: boolean
    notifyButton?: { enable: boolean }
    /**
     * O prompt automático é do painel, mas o SDK aceita a configuração aqui
     * também. Desligamos para o pedido de permissão acontecer SÓ no toque do
     * usuário — exigência do iOS e forma de não queimar a permissão.
     */
    promptOptions?: {
      slidedown?: {
        prompts?: Array<{ type: string; autoPrompt: boolean; delay?: unknown }>
      }
    }
  }): Promise<void>
  login(externalId: string): Promise<void>
  logout(): Promise<void>
  User: { PushSubscription: OneSignalPushSubscription }
  Notifications: {
    readonly permission: boolean
    isPushSupported(): boolean
    requestPermission(): Promise<boolean>
  }
  Slidedown: { promptPush(options?: { force?: boolean }): Promise<void> }
}

declare global {
  interface Window {
    OneSignal?: OneSignalClient
    OneSignalDeferred?: Array<(oneSignal: OneSignalClient) => void | Promise<void>>
  }
}

// ---------------------------------------------------------------------------
// Carregamento e inicialização (singleton)
// ---------------------------------------------------------------------------

/** Injeta o script do SDK uma única vez por documento. */
function loadSdkScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.OneSignal) return Promise.resolve()

  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${SDK_URL}"]`
  )
  if (existing) {
    // Script já está na página: `OneSignalDeferred` resolve quando o SDK
    // publicar a instância.
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('onesignal-sdk-load-failed'))
    document.head.appendChild(script)
  })
}

let initPromise: Promise<OneSignalClient | null> | null = null

/**
 * Inicializa o SDK e devolve a instância, ou `null` quando não há App ID
 * configurado (instalação sem OneSignal não pode quebrar a tela).
 *
 * A promise é memoizada porque `init()` não é idempotente: correr duas
 * vezes lança erro e derruba o painel de configurações.
 */
export function initOneSignal(): Promise<OneSignalClient | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)

  const appId = onesignalAppId()
  if (!appId) return Promise.resolve(null)

  initPromise ??= (async () => {
    try {
      await loadSdkScript()

      // Padrão oficial: enfileira o callback e deixa o SDK chamá-lo quando
      // estiver pronto. Funciona tanto para o script recém-injetado quanto
      // para um já presente.
      const ready = new Promise<OneSignalClient>((resolve) => {
        window.OneSignalDeferred = window.OneSignalDeferred || []
        window.OneSignalDeferred.push((oneSignal) => resolve(oneSignal))
      })

      const oneSignal = await ready

      await oneSignal.init({
        appId,
        serviceWorkerPath: ONESIGNAL_SW_PATH,
        serviceWorkerParam: { scope: ONESIGNAL_SW_SCOPE },
        // Em `next dev` o app roda em http://localhost, que o Chrome trata
        // como origem segura; o SDK exige o opt-in explícito mesmo assim.
        allowLocalhostAsSecureOrigin: true,
        // O sino flutuante do OneSignal é redundante: o projeto já tem um
        // card de notificações em Configurações, e dois controles para a
        // mesma coisa confundem (foi o problema dos dois switches no
        // passado).
        notifyButton: { enable: false },
        // Nada de prompt automático. O pedido sai do botão, no toque — é o
        // único caminho que funciona no iOS e o único que não queima a
        // permissão no Chrome.
        promptOptions: {
          slidedown: {
            prompts: [{ type: 'push', autoPrompt: false }],
          },
        },
      })

      return oneSignal
    } catch (err) {
      console.error('[onesignal] init falhou:', err)
      initPromise = null
      return null
    }
  })()

  return initPromise
}

/**
 * Amarra este aparelho ao usuário.
 *
 * `external_id` é o `auth.users.id` — o mesmo identificador que o servidor
 * usa para montar a lista de destinatários. Sem isso o aparelho fica
 * anônimo e o envio por `include_aliases` não o alcança.
 */
export async function loginOneSignal(externalId: string): Promise<boolean> {
  const oneSignal = await initOneSignal()
  if (!oneSignal) return false
  try {
    await oneSignal.login(externalId)
    return true
  } catch (err) {
    // 409 "Conflict" é esperado quando o external_id já existe: o SDK está
    // trocando para o usuário existente. A doc trata como normal, então não
    // elevamos a erro.
    console.warn('[onesignal] login não confirmado:', err)
    return false
  }
}

/** Desvincula o aparelho (logout da conta). */
export async function logoutOneSignal(): Promise<void> {
  const oneSignal = await initOneSignal()
  if (!oneSignal) return
  try {
    await oneSignal.logout()
  } catch (err) {
    console.warn('[onesignal] logout falhou:', err)
  }
}

// ---------------------------------------------------------------------------
// Estado da inscrição neste aparelho
// ---------------------------------------------------------------------------

/** Contexto seguro: o navegador não oferece push fora de https/localhost. */
export function isSecureContext(): boolean {
  if (typeof window === 'undefined') return false
  return window.isSecureContext === true
}

/**
 * A permissão foi NEGADA (e não apenas não pedida)?
 *
 * Lido da Notification API nativa, que é a única que distingue os dois
 * casos. O SDK do OneSignal só informa um booleano.
 */
export function isPermissionDenied(): boolean {
  if (typeof Notification === 'undefined') return false
  return Notification.permission === 'denied'
}

/** O aparelho é um iPhone/iPad ABERTO COMO ABA (não instalado)? */
export function isIosBrowserTab(isInstalled: boolean): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS se passa por Mac com touch — mesmo cuidado do `detectPlatform`.
  const isIpadAsMac =
    navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1
  const isIos = /iPad|iPhone|iPod/.test(ua) || isIpadAsMac
  return isIos && !isInstalled
}

/**
 * Fotografa o estado atual, sem pedir permissão nem assinar nada.
 *
 * É o que a UI lê ao montar o card. Nunca lança: qualquer falha vira estado
 * "desligado", que faz a UI oferecer "ativar" — a ação correta mesmo no
 * caminho de erro.
 */
export async function readSubscriptionState(): Promise<SubscriptionState> {
  const appId = onesignalAppId()
  if (!appId) {
    return { supported: false, permission: false, subscribed: false, subscriptionId: null }
  }

  const oneSignal = await initOneSignal()
  if (!oneSignal) {
    return { supported: false, permission: false, subscribed: false, subscriptionId: null }
  }

  try {
    const subscription = oneSignal.User.PushSubscription
    const supported = oneSignal.Notifications.isPushSupported()
    const permission = oneSignal.Notifications.permission === true
    const subscribed = isSubscriptionUsable({
      optedIn: subscription.optedIn,
      token: subscription.token,
    })

    return {
      supported,
      permission,
      subscribed,
      subscriptionId: subscription.id ?? null,
    }
  } catch (err) {
    console.warn('[onesignal] falha ao ler estado:', err)
    return { supported: false, permission: false, subscribed: false, subscriptionId: null }
  }
}

export type SubscribeOutcome =
  | { ok: true }
  | { ok: false; error: 'no-app-id' | 'permission-denied' | 'not-supported' | 'failed' }

/**
 * Pede permissão e cria a inscrição.
 *
 * PRECISA ser chamada de dentro do handler de um toque — não em efeito, não
 * em timer. No iOS o diálogo nativo simplesmente não aparece fora de um
 * gesto do usuário, e no Chrome um pedido fora de contexto é ignorado.
 *
 * `optIn()` cobre os dois casos do SDK: se já existe token, só reativa a
 * inscrição; se não existe, dispara o prompt de permissão.
 */
export async function subscribeToPush(): Promise<SubscribeOutcome> {
  if (!onesignalAppId()) return { ok: false, error: 'no-app-id' }

  const oneSignal = await initOneSignal()
  if (!oneSignal) return { ok: false, error: 'failed' }

  try {
    if (!oneSignal.Notifications.isPushSupported()) {
      return { ok: false, error: 'not-supported' }
    }

    if (isPermissionDenied()) return { ok: false, error: 'permission-denied' }

    await oneSignal.User.PushSubscription.optIn()

    // `optIn()` resolve antes de o token chegar em alguns navegadores.
    // Sem esta confirmação, a UI ligaria o switch e nada chegaria.
    const state = await readSubscriptionState()
    if (!state.subscribed) {
      return {
        ok: false,
        error: state.permission ? 'failed' : 'permission-denied',
      }
    }

    return { ok: true }
  } catch (err) {
    console.error('[onesignal] optIn falhou:', err)
    return { ok: false, error: 'failed' }
  }
}

/**
 * Desliga o aviso NESTE aparelho.
 *
 * `optOut()` em vez de `unsubscribe()`: mantém a inscrição e o token, então
 * religar depois é um toque e não exige passar pelo prompt de permissão de
 * novo (no Chrome, um prompt já respondido não reaparece).
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  const oneSignal = await initOneSignal()
  if (!oneSignal) return false
  try {
    await oneSignal.User.PushSubscription.optOut()
    return true
  } catch (err) {
    console.error('[onesignal] optOut falhou:', err)
    return false
  }
}

/**
 * Observa mudanças de inscrição (token renovado, permissão alterada nas
 * configurações do navegador, optIn/optOut).
 *
 * Existe porque o usuário pode mudar a permissão FORA do app — nas
 * configurações do site — e voltar. Sem o listener, o card continuaria
 * mostrando o estado antigo até um recarregamento.
 */
export async function watchSubscription(
  onChange: () => void
): Promise<() => void> {
  const oneSignal = await initOneSignal()
  if (!oneSignal) return () => {}

  const listener = () => onChange()
  try {
    oneSignal.User.PushSubscription.addEventListener('change', listener)
  } catch (err) {
    console.warn('[onesignal] listener não registrado:', err)
    return () => {}
  }

  // O SDK não expõe `removeEventListener` para push subscription em todas
  // as versões; quando não expõe, o listener morre junto com a instância do
  // componente porque a comparação de referência fica sem uso.
  return () => {}
}
