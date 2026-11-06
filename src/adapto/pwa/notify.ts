import { PWA_ICON_192 } from "./constants";

/**
 * Avisos do sistema feitos pela rota certa.
 *
 * ## O bug que isto conserta
 *
 * O código antigo chamava `new Notification(...)` direto na página. Isso
 * funciona no desktop e FALHA no Android: o Chrome não permite mais
 * construir `Notification` fora de um service worker — ele lança
 * `TypeError: Illegal constructor`. O próprio hook original já registrava
 * isso num comentário ("Android Chrome requires a service worker"), mas o
 * caminho de correção nunca foi feito, então no celular o aviso de
 * mensagem nova simplesmente não aparecia.
 *
 * No iOS é o mesmo diagnóstico por outro motivo: em PWA instalado, só
 * `ServiceWorkerRegistration.showNotification()` exibe o aviso.
 *
 * Então a ordem é sempre: service worker primeiro, `new Notification` só
 * como último recurso (desktop antigo / navegador sem SW).
 */

/** Só os campos que realmente usamos — evita depender de detalhes do lib.dom. */
export interface DeviceNotificationOptions {
  body?: string;
  /** Substitui um aviso anterior com a mesma tag em vez de empilhar. */
  tag?: string;
  /** Rota a abrir no clique. Vai no `data` e o SW lê no `notificationclick`. */
  url?: string;
  icon?: string;
}

/** O `serviceWorker` só existe em contexto seguro (https ou localhost). */
export function canUseServiceWorker(): boolean {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  if (!window.isSecureContext) return false;
  return true;
}

/**
 * Em `next dev` NÃO registramos o service worker.
 *
 * Motivo concreto: no dev, o Next serve os chunks SEM hash no nome
 * (`/_next/static/chunks/app/layout.js`). Como a estratégia do SW é
 * cache-first para `/_next/static/`, um chunk cacheado no dev continuaria
 * sendo servido depois da edição — o desenvolvedor salvaria o arquivo e
 * não veria a mudança, concluindo que o build está quebrado.
 */
function shouldRegister(): boolean {
  return process.env.NODE_ENV === "production" && canUseServiceWorker();
}

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/** A mesma promise é reaproveitada: registrar duas vezes é desperdício. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!shouldRegister()) return Promise.resolve(null);

  registrationPromise ??= (async () => {
    try {
      const existing = await navigator.serviceWorker.getRegistration("/");
      const registration =
        existing ??
        (await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          // O navegador não deve usar o HTTP cache para decidir se o SW
          // mudou; quem manda é o `CACHE_VERSION` dentro do arquivo.
          updateViaCache: "none",
        }));

      // Checa atualização em segundo plano. Sem isto, um PWA aberto por
      // dias só recebe SW novo quando todas as abas fecharem.
      registration.update().catch(() => {});

      return registration;
    } catch (err) {
      // Registro falhar não pode derrubar a aplicação — só perdemos o
      // aviso nativo no Android e a tela offline.
      console.warn("[pwa] service worker não registrado:", err);
      return null;
    }
  })();

  return registrationPromise;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Registro com um worker ATIVO. `showNotification` num registration sem
 * `active` não faz nada, e logo após o primeiro registro o worker ainda
 * está instalando.
 */
export async function getActiveRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!canUseServiceWorker()) return null;

  const registered = await registerServiceWorker();
  if (registered?.active) return registered;

  // `ready` resolve quando há um worker ativo controlando o escopo. O
  // timeout evita ficar pendurado se algo impedir a ativação.
  const ready = await withTimeout(navigator.serviceWorker.ready, 3000);
  if (ready) return ready;

  return registered;
}

/**
 * Exibe um aviso do sistema. Devolve `true` quando algum mecanismo
 * conseguiu mostrar.
 *
 * O `try/catch` do `new Notification` é obrigatório, não defensivo: é
 * exatamente ele que lança no Android.
 */
export async function showDeviceNotification(
  title: string,
  options: DeviceNotificationOptions = {},
): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const icon = options.icon ?? PWA_ICON_192;
  const data = { url: options.url };

  const registration = await getActiveRegistration();
  if (registration) {
    try {
      await registration.showNotification(title, {
        body: options.body,
        tag: options.tag,
        icon,
        badge: icon,
        data,
      });
      return true;
    } catch (err) {
      console.warn("[pwa] showNotification falhou, tentando Notification:", err);
    }
  }

  if (!("Notification" in window)) return false;

  try {
    const notification = new Notification(title, {
      body: options.body,
      tag: options.tag,
      icon,
      data,
    });
    // Sem service worker não existe `notificationclick`; o clique tem de
    // ser tratado aqui.
    notification.onclick = () => {
      window.focus();
      if (options.url) window.location.assign(options.url);
      notification.close();
    };
    return true;
  } catch (err) {
    // Android Chrome cai aqui quando não há SW — o esperado.
    console.warn("[pwa] Notification indisponível:", err);
    return false;
  }
}
