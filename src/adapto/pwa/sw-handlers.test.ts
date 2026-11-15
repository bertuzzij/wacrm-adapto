import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * O service worker da raiz não pode disputar os eventos de push.
 *
 * ## O bug que isto impede (histórico)
 *
 * O relato original foi "o push não funciona na tela bloqueada", com o
 * servidor entregando normalmente — dois aparelhos aceitando o envio (201) e
 * nada aparecendo.
 *
 * A causa: quando o handler de push foi trocado por uma versão com
 * `renotify`, a substituição textual inseriu o novo ANTES do antigo em vez
 * de substituí-lo. Ficaram dois `self.addEventListener("push", …)`. O
 * navegador executa todos os listeners registrados, então os dois disputavam
 * a mesma notificação. Nada disso aparece em typecheck ou lint: o arquivo é
 * JavaScript puro em `public/`, fora do grafo de módulos.
 *
 * ## O que mudou na migração para o OneSignal
 *
 * O evento `push` deixou de ser tratado aqui: quem recebe é o worker do
 * OneSignal, em `/push/onesignal/`. Manter um handler neste arquivo seria
 * pior que código morto — se ele algum dia fosse chamado, o Safari
 * revogaria a permissão quando a notificação não fosse exibida, e dois
 * caminhos de exibição disputariam o mesmo aviso (o bug acima, de novo).
 *
 * O teste acompanhou a mudança: em vez de exigir UM handler de push com
 * `renotify`, agora exige ZERO handlers de push. A `notificationclick`
 * continua obrigatória e única — ela ainda serve o aviso feito pela própria
 * página (aba aberta), que não passa pelo OneSignal.
 */

const ROOT = process.cwd()
const SW = readFileSync(join(ROOT, 'public/sw.js'), 'utf8')

/** Conta registros de `self.addEventListener("<tipo>", …)`. */
function countListeners(type: string): number {
  const pattern = new RegExp(
    `self\\.addEventListener\\(\\s*["']${type}["']`,
    'g',
  )
  return (SW.match(pattern) ?? []).length
}

describe('service worker — push é do worker do OneSignal, não daqui', () => {
  it('não registra nenhum listener de push', () => {
    // Dois handlers de push = o bug do "aceita o envio e nada aparece".
    // Depois da migração, o correto é não haver nenhum aqui.
    expect(countListeners('push'), 'handler de push sobrou no sw.js').toBe(0)
  })

  it('registra exatamente um listener de notificationclick', () => {
    // Este FICA: o aviso feito pela página (src/adapto/pwa/notify.ts) usa
    // este worker e depende do clique. Duplicar quebraria o mesmo jeito.
    expect(countListeners('notificationclick')).toBe(1)
  })

  it('explica no próprio arquivo por que o handler saiu', () => {
    // Quem ler o sw.js depois precisa saber que a ausência é deliberada —
    // sem isso, "consertar" o handler é o movimento natural e reintroduz o
    // bug.
    expect(SW).toMatch(/handler `push` daqui foi REMOVIDO|OneSignal/)
  })
})

describe('service worker — cache versionado', () => {
  it('declara CACHE_VERSION', () => {
    expect(SW).toMatch(/CACHE_VERSION\s*=\s*["']v\d+["']/)
  })

  it('apaga caches de versões anteriores no activate', () => {
    // Sem isto, um PWA instalado continua servindo o bundle antigo —
    // inclusive um service worker velho com o handler de push do VAPID.
    expect(SW).toMatch(/caches\.keys\(\)/)
    expect(SW).toMatch(/caches\.delete/)
  })

  it('a versão subiu na migração do OneSignal', () => {
    // O worker antigo tinha o handler de push; um PWA instalado só troca
    // de worker quando o texto muda, então o incremento é obrigatório.
    expect(SW).toMatch(/CACHE_VERSION\s*=\s*["']v3["']/)
  })
})

describe('service worker — o que continua igual', () => {
  it('navegação é network-first, nunca cache-first', () => {
    // HTML cacheado de um deploy antigo referencia chunks que não existem
    // mais — tela sem estilo, ou app "fantasma".
    expect(SW).toMatch(/request\.mode\s*===\s*["']navigate["']/)
  })

  it('só intercepta GET', () => {
    // Interceptar escrita (enviar mensagem, salvar contato) é a receita
    // para ação duplicada.
    expect(SW).toMatch(/request\.method\s*!==\s*["']GET["']/)
  })
})
