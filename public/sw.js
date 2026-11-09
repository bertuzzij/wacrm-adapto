/* global self, caches, clients, fetch */

/**
 * Service worker do AdaptoConect.
 *
 * ESTE ARQUIVO É DELIBERADAMENTE CONSERVADOR. Leia antes de "melhorar".
 *
 * O app é um CRM autenticado servido por Next.js (App Router), com dados
 * por usuário vindos do Supabase por cima de cookies de sessão. Um service
 * worker que cacheia HTML e respostas de API é a forma mais fácil de
 * quebrar isso de três jeitos que já são clássicos:
 *
 *   1. HTML cacheado de um deploy antigo referencia chunks
 *      `/_next/static/<hash>.js` que não existem mais → tela sem estilo,
 *      ou pior, app "fantasma" que só conserta com cache limpo.
 *   2. Resposta de API cacheada de OUTRO usuário aparecendo para quem
 *      entrou depois no mesmo aparelho — vazamento de dados entre contas.
 *   3. Sessão expirada + offline = o usuário preso numa casca que não
 *      autentica e não diz por quê.
 *
 * Por isso a estratégia aqui é:
 *
 *   - `/_next/static/*` e `/icons/*` → cache-first. São assets com hash no
 *     nome (imutáveis), então servir do cache nunca fica velho.
 *   - Navegação (HTML) → network-first, SEMPRE. O servidor manda
 *     `Cache-Control: private, no-store` e o `fetch` precisa ser
 *     `cache: "no-store"` para o HTTP cache do navegador não entregar HTML
 *     velho por baixo. Se a rede falhar, cai na tela offline.
 *   - Qualquer outra coisa (API, RSC payload, Supabase, redirect de auth)
 *     → passa direto, sem tocar. O SW não intercepta o que não entende.
 *
 * O ganho real que justifica o SW aqui NÃO é offline — é a notificação.
 * Android Chrome proíbe `new Notification()` na página e exige
 * `ServiceWorkerRegistration.showNotification()`. Sem um SW registrado, o
 * aviso de mensagem nova simplesmente não aparece no PWA instalado. Esse
 * é o motivo principal de o arquivo existir.
 */

// Suba este número a cada mudança de comportamento do SW — ou a cada
// deploy em que um PWA já instalado precise largar o bundle antigo. O
// navegador só troca o worker quando o texto do arquivo muda; o `activate`
// abaixo apaga os caches antigos por prefixo.
//
// v2: subiu junto com a instalação guiada (card em Configurações e botão no
// header). Um app JÁ instalado guarda em cache-first os chunks
// `/_next/static/*` da versão anterior, e sem este incremento continuaria
// rodando o bundle velho — sem o botão de instalar e sem as correções de
// teclado no iOS — até o cache expirar por conta própria.
const CACHE_VERSION = "v2";
const STATIC_CACHE = `adaptoconect-static-${CACHE_VERSION}`;

/** Página mostrada quando a navegação falha e não há nada em cache. */
const OFFLINE_URL = "/offline.html";

/**
 * Pré-cache mínimo: só a tela offline. Nada de HTML autenticado e nada de
 * API — ver o bloco acima.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // `reload` para não pegar uma cópia velha do HTTP cache.
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" })).catch(() => {
        // Falhar aqui não pode impedir a instalação: a tela offline é
        // conveniência, a notificação (o motivo do SW existir) não depende
        // dela.
      });
      // Assume o controle sem esperar as abas antigas fecharem — o usuário
      // não deveria precisar fechar o PWA para a notificação passar a
      // funcionar.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Descarta caches de versões anteriores deste SW. Prefixo específico
      // para nunca apagar cache alheio à mesma origem.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("adaptoconect-") && key !== STATIC_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Assets imutáveis por construção (hash no nome). */
function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Só GET. POST/PATCH/DELETE (envio de mensagem, salvar contato, login)
  // passam direto: interceptar escrita num SW é a receita para ação
  // duplicada.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Origem diferente (Supabase, avatares, mídia) → não é da nossa conta.
  if (url.origin !== self.location.origin) return;

  // Navegação: network-first com fallback para a tela offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          // `no-store` é obrigatório aqui: sem ele o HTTP cache do próprio
          // navegador pode devolver o HTML de um deploy anterior mesmo com
          // a rede disponível.
          return await fetch(request, { cache: "no-store" });
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          const offline = await cache.match(OFFLINE_URL);
          if (offline) return offline;
          // Sem tela offline em cache: deixa o erro do navegador aparecer
          // em vez de inventar uma resposta.
          return Response.error();
        }
      })(),
    );
    return;
  }

  // Assets com hash → cache-first, populando em segundo plano.
  if (isImmutableAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        // Só guarda resposta boa e completa.
        if (response.ok && response.type === "basic") {
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      })(),
    );
  }

  // Todo o resto (API, RSC, manifest, sw) → sem interceptação.
});

/**
 * Web Push: ainda não há servidor de push (o alerta é disparado pelo
 * realtime do Supabase com a aba aberta). Este handler existe para o dia
 * em que houver, e porque um `push` sem handler faz o navegador mostrar
 * "site atualizado em segundo plano" — um aviso inútil e confuso.
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "AdaptoConect";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: payload.icon || "/icons/icon-192.png",
      // `badge` é monocromático no Android; o ícone colorido vira um
      // quadrado branco na barra de status.
      badge: "/icons/icon-192.png",
      tag: payload.tag,
      data: { url: payload.url || "/inbox" },
    }),
  );
});

/**
 * Web Push: o aviso que chega com o app FECHADO.
 *
 * O payload é montado no servidor (src/adapto/push/payload.ts) e assinado
 * com VAPID. Este handler só exibe.
 *
 * `renotify` + `tag` juntos são obrigatórios num chat: sem `renotify`, a
 * segunda mensagem do mesmo cliente SUBSTITUI o aviso anterior em silêncio e
 * o usuário não é alertado de que chegou algo novo. Com `tag` sozinho o
 * agrupamento funciona, mas a substituição é muda. Com os dois, ele agrupa
 * por conversa E vibra de novo.
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Payload não-JSON (ou vazio) ainda precisa produzir um aviso: o
    // navegador revoga a inscrição se o push não resultar em notificação
    // visível (`userVisibleOnly: true`).
    payload = {};
  }

  const title = payload.title || "AdaptoConect";
  const options = {
    body: payload.body || "Voce tem uma nova mensagem.",
    icon: payload.icon || "/icons/icon-192.png",
    // `badge` é monocromático no Android — o ícone colorido vira um
    // quadrado branco na barra de status.
    badge: "/icons/badge-96.png",
    // `tag` agrupa por conversa; `renotify` garante que a substituição
    // ainda alerte em vez de trocar o texto em silêncio.
    tag: payload.tag || "adaptoconect-message",
    renotify: true,
    data: { url: payload.url || "/inbox" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = new URL(
    (event.notification.data && event.notification.data.url) || "/inbox",
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        // Manda a navegação para a aba existente: recarregar a janela
        // inteira perderia o estado do inbox (conversa aberta, rascunho).
        client.postMessage({ type: "navigate", url: target });
        if ("focus" in client) return client.focus();
        return undefined;
      }

      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })(),
  );
});
