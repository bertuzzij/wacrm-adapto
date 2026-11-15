import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * O switch de push não pode mentir.
 *
 * ## O bug que isto impede (histórico, e por que o teste sobreviveu)
 *
 * Na versão VAPID, o usuário viu o pior estado possível: o toast "Não foi
 * possível ativar as notificações" E o switch verde dizendo "Ativo neste
 * aparelho", ao mesmo tempo, sem nenhum push chegar.
 *
 * A causa era assimetria entre as duas pontas: `subscribeToPush()` criava a
 * inscrição no NAVEGADOR e só depois tentava salvar no SERVIDOR. Quando o
 * POST falhava, a inscrição do navegador ficava órfã — e a UI, que só olhava
 * o navegador, lia "existe inscrição = ativo".
 *
 * ## O que mudou com o OneSignal, e o que NÃO mudou
 *
 * As duas pontas mudaram de lugar: agora são "permissão do navegador" e
 * "inscrição ativa no SDK (optedIn + token)". A REGRA é a mesma e continua
 * valendo: o switch só fica verde quando as duas concordam. Estes testes
 * amarram a nova arquitetura à mesma promessa, em vez de simplesmente
 * apagá-los junto com o código antigo.
 */

const ROOT = process.cwd()

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8')
}

/** Remove comentários: o comentário que explica o bug contém o padrão do bug. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('a inscrição só conta como ativa com as DUAS pontas', () => {
  const subscription = stripComments(read('src/adapto/onesignal/subscription.ts'))

  it('exige optedIn E token, não apenas optedIn', () => {
    // `optedIn` pode ser true enquanto o token ainda não chegou — o SDK
    // resolve `optIn()` antes de o navegador emitir o token. Inscrição sem
    // token não recebe nada, então confiar só no booleano repetiria o bug.
    expect(subscription).toMatch(/optedIn\s*===\s*true\s*&&\s*Boolean\(state\.token\)/)
  })

  it('resolve o status considerando permissão E inscrição', () => {
    // O estado "on" exige as duas; qualquer uma faltando vira "off".
    expect(subscription).toMatch(/if\s*\(subscribed\s*&&\s*permission\)\s*return\s*'on'/)
  })
})

describe('o card lê o estado real, não o que supõe ter acontecido', () => {
  const card = stripComments(read('src/adapto/push/push-card.tsx'))

  it('re-lê o estado do SDK depois de ligar/desligar', () => {
    // Foi confiar na suposição que produziu o switch verde com zero
    // entrega. O `await refresh()` no `finally` é a garantia.
    expect(card).toMatch(/finally\s*\{[\s\S]{0,400}?await refresh\(\)/)
  })

  it('não escreve o estado otimista direto (setState do que "deveria" ser)', () => {
    // `setSubscribed(true)` logo após o sucesso era exatamente a linha que
    // fazia o switch mentir quando o servidor recusava.
    expect(card).not.toMatch(/setSubscribed\(true\)/)
    expect(card).not.toMatch(/setSubscribed\(Boolean/)
  })

  it('o estado vem de readSubscriptionState, que consulta o SDK', () => {
    expect(card).toMatch(/readSubscriptionState/)
  })
})

describe('o pedido de permissão sai de um toque, nunca de um efeito', () => {
  const card = stripComments(read('src/adapto/push/push-card.tsx'))

  it('subscribeToPush é chamado no handler, não no useEffect', () => {
    // No iOS o diálogo nativo não aparece fora de gesto do usuário; no
    // Chrome um pedido em efeito é ignorado e, se negado, é permanente.
    const effectBlock = card.match(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[[^\]]*\]\)/g) ?? []
    for (const block of effectBlock) {
      expect(block).not.toMatch(/subscribeToPush/)
    }
    expect(card).toMatch(/onToggle/)
  })
})

describe('o cliente amarra o aparelho ao usuário (external_id)', () => {
  const identity = stripComments(read('src/adapto/onesignal/identity.tsx'))
  const client = stripComments(read('src/adapto/onesignal/client.ts'))

  it('chama login com o id do usuário logado', () => {
    // Sem `external_id` o aparelho fica anônimo no OneSignal e nenhum envio
    // por alias o alcança: "ativei, ficou verde e não chega nada".
    expect(identity).toMatch(/loginOneSignal\(userId\)/)
  })

  it('desvincula no caminho de saída', () => {
    // Aparelho compartilhado continuaria recebendo avisos da conta anterior.
    expect(identity).toMatch(/logoutOneSignal\(\)/)
    expect(client).toMatch(/export async function logoutOneSignal/)
  })
})

describe('o envio usa o OneSignal e mira por alias', () => {
  const sender = stripComments(read('src/adapto/push/sender.ts'))

  it('usa include_aliases com external_id — a forma recomendada', () => {
    expect(sender).toMatch(/include_aliases/
    )
    expect(sender).toMatch(/external_id/)
  })

  it('declara target_channel, obrigatório junto de include_aliases', () => {
    // Sem `target_channel` a API rejeita o alias como alvo ambíguo.
    expect(sender).toMatch(/target_channel:\s*'push'/)
  })

  it('busca os membros por profiles.user_id, nunca por profiles.id', () => {
    // `profiles.id` é a PK da linha; confundir as duas compila, roda e
    // devolve vazio — erro já pago neste fork.
    expect(sender).toMatch(/\.from\(\s*'profiles'\s*\)/)
    expect(sender).toMatch(/select\(\s*'user_id'\s*\)/)
    expect(sender).not.toMatch(/\.eq\(\s*'id'\s*,/)
  })

  it('nunca lança: o webhook do WhatsApp precisa responder 200', () => {
    expect(sender).toMatch(/catch/)
    expect(sender).toMatch(/skipped:\s*true/)
  })
})

describe('o service worker do OneSignal não disputa o escopo da raiz', () => {
  const config = stripComments(read('src/adapto/onesignal/config.ts'))

  it('usa um escopo de subpasta', () => {
    // Só um service worker controla um escopo. O `/sw.js` do projeto cuida
    // de cache e tela offline na raiz; o do OneSignal precisa viver abaixo.
    expect(config).toMatch(/ONESIGNAL_SW_SCOPE\s*=\s*'\/push\/onesignal\/'/)
  })

  it('o caminho do worker é relativo, como o painel exibe', () => {
    expect(config).toMatch(/ONESIGNAL_SW_PATH\s*=\s*'push\/onesignal\/OneSignalSDKWorker\.js'/)
  })

  it('o sw.js da raiz não tem mais handler de push', () => {
    // Dois handlers de push competiriam, e o Safari revoga a permissão
    // quando o handler não exibe a notificação.
    const sw = stripComments(read('public/sw.js'))
    expect(sw).not.toMatch(/addEventListener\(\s*["']push["']/)
  })

  it('a subida do CACHE_VERSION acompanha a mudança do sw.js', () => {
    // Sem o incremento, um PWA já instalado continua no worker antigo.
    const sw = read('public/sw.js')
    expect(sw).toMatch(/CACHE_VERSION\s*=\s*["']v3["']/)
  })
})

describe('init() não passa opções que o Typical Site ignora', () => {
  const client = stripComments(read('src/adapto/onesignal/client.ts'))

  /**
   * O bug que isto impede, e que custou um deploy.
   *
   * A app está configurada no painel como Typical Site. A doc do OneSignal:
   *
   *   "Init options only work with Custom Code Setup."
   *   "Mixing the two does not work: ... `serviceWorkerPath` does not apply
   *    to Typical Site."
   *
   * A primeira versão passava `serviceWorkerPath` junto com
   * `serviceWorkerParam`. Em Typical Site os dois foram IGNORADOS: o SDK
   * voltou para o padrão de raiz (`/OneSignalSDKWorker.js`, 404), não
   * registrou worker nenhum, e a inscrição nunca aconteceu. Do ponto de
   * vista do usuário: "ativei e a welcome notification não chegou", sem
   * erro visível — as opções erradas não falham, elas somem.
   */
  it.each([
    ['serviceWorkerPath', /serviceWorkerPath\s*:/],
    ['serviceWorkerParam', /serviceWorkerParam\s*:/],
    ['promptOptions', /promptOptions\s*:/],
    ['notifyButton', /notifyButton\s*:/],
  ])('não passa %s no init()', (_name, pattern) => {
    expect(client).not.toMatch(pattern)
  })

  it('passa apenas appId e allowLocalhostAsSecureOrigin', () => {
    // Se um dia a app virar Custom Code, estas opções passam a valer — e
    // este teste deve ser trocado junto, não contornado.
    expect(client).toMatch(/allowLocalhostAsSecureOrigin:\s*true/)
    expect(client).toMatch(/appId,/)
  })
})
