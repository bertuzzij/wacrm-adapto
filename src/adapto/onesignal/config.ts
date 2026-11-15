/**
 * Configuração do OneSignal — o lado que vale para cliente E servidor.
 *
 * ## Por que o OneSignal substituiu o Web Push próprio
 *
 * A implementação anterior (`web-push` + VAPID + o handler `push` dentro de
 * `public/sw.js`) entregava notificação no desktop e falhava justamente onde
 * o cliente usa o sistema: no celular. Os quatro motivos medidos:
 *
 *   1. **iOS nunca funcionou.** A Apple só mostra o diálogo nativo a partir
 *      de um TOQUE dentro do web app instalado. O botão vivia em
 *      Configurações, atrás de um aviso "instale primeiro" — então o toque
 *      que a Apple exige quase nunca acontecia.
 *   2. **Cada deploy derrubava a inscrição.** O `sw.js` sobe o
 *      `CACHE_VERSION` a cada release; o PWA reinstala o worker e a
 *      inscrição de push se perde sem que ninguém perceba.
 *   3. **Zero visibilidade.** O `web-push` devolve um código de status e
 *      mais nada: não há como saber se entregou, se foi aberto, nem por que
 *      falhou. Foi assim que o erro `no-vapid-key` virou um bug de dias.
 *   4. **Safari revoga a permissão** quando chega um push e o próprio
 *      handler não exibe a notificação visível.
 *
 * O OneSignal resolve os quatro: cuida do VAPID, do service worker, da
 * renovação da inscrição e dá painel de entrega.
 *
 * ## O caminho do service worker NÃO é detalhe
 *
 * Só um service worker pode controlar um escopo. O projeto já tem
 * `public/sw.js` na raiz fazendo cache e tela offline — e ele é
 * deliberadamente conservador (ver o cabeçalho dele). Por isso o worker do
 * OneSignal mora numa SUBPASTA (`/push/onesignal/`), com escopo próprio, em
 * vez de disputar a raiz. A documentação recomenda exatamente isso para
 * quem já tem PWA.
 *
 * A consequência prática: este caminho precisa bater em DOIS lugares —
 * aqui (no `init`) e no painel do OneSignal, em *Advanced Push Settings →
 * Customize service worker paths and filenames*. Configurar só um dos dois
 * faz o registro do worker falhar em silêncio.
 */

/**
 * Subpasta do worker do OneSignal.
 *
 * **Estas duas constantes NÃO são passadas ao SDK.** Elas existem como
 * documentação executável do que precisa estar configurado no painel, e os
 * testes leem daqui. A app é **Typical Site**, e nesse modo a doc é
 * explícita: `serviceWorkerPath` no `init()` é ignorado — quem manda é
 * *Advanced Push Settings → Customize service worker paths and filenames*.
 *
 * (A primeira versão passava essas constantes no `init()`. O SDK ignorou,
 * voltou a procurar o worker na raiz, achou 404 e nunca registrou nada — o
 * sintoma foi "ativei e a welcome notification não chegou".)
 */
export const ONESIGNAL_SW_SCOPE = '/push/onesignal/'

/** Caminho relativo do worker, como aparece no painel (sem barra inicial). */
export const ONESIGNAL_SW_PATH = 'push/onesignal/OneSignalSDKWorker.js'

/**
 * Origem pública do app, usada só para montar a URL absoluta do ícone.
 *
 * `NEXT_PUBLIC_SITE_URL` é o mesmo valor que vai no campo **Site URL** do
 * painel. Se os dois divergirem (por exemplo `www.` de um lado e não do
 * outro), o navegador trata como origem diferente e a inscrição não vale.
 */
function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL
  if (!raw) return ''
  return raw.replace(/\/+$/, '')
}

/** Ícone padrão das notificações (256×256, exigido pelo painel). */
export function notificationIconUrl(): string {
  const base = siteUrl()
  return base ? `${base}/icons/icon-256.png` : '/icons/icon-256.png'
}

/**
 * App ID do OneSignal.
 *
 * É público por natureza — vai embutido no bundle do navegador e não dá
 * acesso a nada além de criar inscrições nesta app. O segredo de verdade é
 * a App API Key (`ONESIGNAL_REST_API_KEY`), que nunca chega ao cliente.
 *
 * Devolve `null` quando ausente para a UI poder dizer "não configurado" em
 * vez de oferecer um botão que falha (o mesmo cuidado do `no-vapid-key`
 * anterior).
 */
export function onesignalAppId(): string | null {
  const id = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID
  return id && id.trim().length > 0 ? id.trim() : null
}

/** Chave da API REST (server-only). Nunca referenciar em componente client. */
export function onesignalRestKey(): string | null {
  const key = process.env.ONESIGNAL_REST_API_KEY
  return key && key.trim().length > 0 ? key.trim() : null
}

/**
 * O envio está configurado?
 *
 * As duas variáveis são necessárias e têm papéis diferentes: a App ID
 * identifica a app, a API Key autoriza o POST. Faltando qualquer uma, o
 * envio vira no-op — o webhook do WhatsApp não pode quebrar por causa
 * disso.
 */
export function isOneSignalConfigured(): boolean {
  return Boolean(onesignalAppId() && onesignalRestKey())
}
