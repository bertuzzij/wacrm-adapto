/**
 * A regra de "este aparelho está inscrito?" — em módulo puro, sem SDK.
 *
 * Separado do `client.ts` pelo mesmo motivo dos outros módulos do adapto: a
 * decisão do que mostrar na tela é testável sem navegador, sem OneSignal e
 * sem rede. O `client.ts` só faz a tradução para as chamadas do SDK.
 *
 * ## O erro que este arquivo existe para impedir
 *
 * A versão anterior (VAPID) tinha exatamente este bug, documentado no
 * `subscribe/route.ts`: o navegador pode ter uma inscrição que o SERVIDOR
 * não conhece (falha de rede depois do `subscribe()`, banco limpo, troca de
 * conta no mesmo aparelho). A UI que confia só no navegador mostrava
 * "Ativo neste aparelho" para um aparelho que nunca receberia nada —
 * ligado e mudo ao mesmo tempo.
 *
 * No OneSignal o estado tem duas camadas que precisam concordar:
 *   - `permission`    → o navegador autorizou avisos?
 *   - `optedIn`/`id`  → o SDK tem uma inscrição ATIVA com token?
 * Uma permissão concedida com `optedIn` falso significa "pode avisar, mas
 * não vai" — é o caso de quem concedeu e depois o SDK não conseguiu
 * registrar.
 */

/** O que o SDK sabe sobre este aparelho, achatado para leitura da UI. */
export interface SubscriptionState {
  /** O navegador dá suporte a push em princípio. */
  supported: boolean
  /** Permissão concedida (browser). */
  permission: boolean
  /** O SDK tem inscrição ativa (token + optedIn). */
  subscribed: boolean
  /** Id da inscrição — útil para diagnóstico e para o usuário reconhecer o aparelho. */
  subscriptionId: string | null
}

export type PushUiStatus =
  /** Instância sem App ID: o push simplesmente não existe aqui. */
  | 'not-configured'
  /** Sem HTTPS (ou contexto inseguro): o navegador não permite. */
  | 'insecure'
  /** Navegador sem suporte a push. */
  | 'unsupported'
  /**
   * iPhone/iPad numa ABA de navegador: push só existe no app instalado.
   * Não é erro — é o caminho normal do iOS, que precisa de instrução.
   */
  | 'ios-needs-install'
  /** Tudo pronto e inscrito. */
  | 'on'
  /** Suportado e permitido, mas sem inscrição ativa. */
  | 'off'
  /** Permissão negada pelo navegador — só o usuário desfaz, nas configs do site. */
  | 'blocked'

export interface PushUiInput {
  configured: boolean
  secureContext: boolean
  supported: boolean
  permission: boolean
  subscribed: boolean
  /**
   * `true` só no iPhone/iPad ABERTO COMO ABA (não instalado).
   *
   * Em aba, o iOS nem define `window.Notification`, então `supported` seria
   * falso — mas "navegador sem suporte" seria um beco sem saída, porque o
   * caminho real existe: instalar o app. Por isso o iOS é checado antes.
   */
  iosBrowserTab: boolean
  /**
   * A permissão foi NEGADA (não apenas ainda não pedida).
   *
   * Vem de fora porque o SDK do OneSignal expõe `permission` como booleano
   * e não distingue "recusou" de "ainda não perguntei". Só a Notification
   * API do navegador reporta `'denied'`. A distinção muda a AÇÃO oferecida:
   * negado → "liberte nas configurações do site"; não pedido → "ativar".
   */
  permissionDenied: boolean
}

/**
 * Traduz o estado em uma situação que a UI sabe explicar.
 *
 * A ordem dos testes é significativa e não alfabética: cada condição
 * anterior torna as seguintes irrelevantes. `not-configured` vem primeiro
 * porque, sem App ID, nem faz sentido perguntar sobre HTTPS ou suporte.
 */
export function resolvePushStatus({
  configured,
  secureContext,
  supported,
  permission,
  subscribed,
  iosBrowserTab,
  permissionDenied,
}: PushUiInput): PushUiStatus {
  if (!configured) return 'not-configured'
  if (!secureContext) return 'insecure'
  if (iosBrowserTab) return 'ios-needs-install'
  if (!supported) return 'unsupported'
  if (subscribed && permission) return 'on'
  if (permissionDenied) return 'blocked'
  return 'off'
}

/**
 * A inscrição está de fato utilizável?
 *
 * Exige as duas pontas, e é deliberadamente estrito: `optedIn` sozinho pode
 * ser `true` enquanto o token ainda não chegou (acontece nos primeiros
 * segundos depois do `optIn()`), e uma inscrição sem token não recebe nada.
 */
export function isSubscriptionUsable(state: {
  optedIn: boolean | null
  token: string | null
}): boolean {
  return state.optedIn === true && Boolean(state.token)
}

/** A UI deve oferecer o botão "ativar"? Só quando ativar é possível e útil. */
export function canOfferActivation(status: PushUiStatus): boolean {
  return status === 'off'
}

/**
 * O aviso de "instale primeiro" deve aparecer?
 *
 * Separado de `resolvePushStatus` para o card poder decidir entre mostrar o
 * switch, a instrução de instalação ou nada — sem repetir a lista de
 * condições.
 */
export function needsInstallHint(status: PushUiStatus): boolean {
  return status === 'ios-needs-install'
}
