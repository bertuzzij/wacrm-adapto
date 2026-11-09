import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * O service worker não pode ter mais de um handler de `push`.
 *
 * ## O bug que isto impede
 *
 * O relato foi "o push não funciona na tela bloqueada", com o servidor
 * entregando normalmente — dois aparelhos aceitando o envio (201) e nada
 * aparecendo.
 *
 * A causa: quando troquei o handler de push por uma versão com `renotify`,
 * a substituição textual inseriu o novo ANTES do antigo em vez de
 * substituí-lo. Ficaram dois `self.addEventListener("push", …)` no arquivo.
 * O navegador executa todos os listeners registrados, então os dois
 * disputavam a mesma notificação: o antigo (sem `renotify`, com o badge
 * colorido) e o novo. O resultado é uma notificação exibida e substituída
 * no mesmo instante, ou comportamento indefinido.
 *
 * Nada disso aparece em typecheck, lint ou nos testes de componente: o
 * arquivo é JavaScript puro em `public/`, fora do grafo de módulos.
 */

const ROOT = process.cwd()
const SW = readFileSync(join(ROOT, 'public/sw.js'), 'utf8')

/** Conta registros de `self.addEventListener("<tipo>", …)`. */
function countListeners(type: string): number {
  const pattern = new RegExp(`self\\.addEventListener\\(\\s*["']${type}["']`, 'g')
  return (SW.match(pattern) ?? []).length
}

describe('service worker — handlers únicos', () => {
  it.each(['push', 'notificationclick'])(
    'registra exatamente um listener de %s',
    (type) => {
      expect(countListeners(type), `listeners de ${type} duplicados`).toBe(1)
    },
  )

  it('o handler de push usa renotify', () => {
    // Sem `renotify`, a segunda mensagem do mesmo cliente substitui o
    // aviso anterior em silêncio.
    expect(SW).toMatch(/renotify:\s*true/)
  })

  it('o handler de push usa o badge monocromático', () => {
    // O ícone colorido em `badge` vira um quadrado branco na barra de
    // status do Android.
    const pushStart = SW.indexOf('self.addEventListener("push"')
    const pushEnd = SW.indexOf('self.addEventListener("notificationclick"')
    const handler = SW.slice(pushStart, pushEnd)
    expect(handler).toMatch(/badge:\s*["']\/icons\/badge-96\.png["']/)
    // O badge colorido não pode voltar.
    expect(handler).not.toMatch(/badge:\s*["']\/icons\/icon-192\.png["']/)
  })

  it('o handler de push sempre exibe uma notificação', () => {
    // O navegador revoga a inscrição quando um push não resulta em
    // notificação visível (`userVisibleOnly: true`). Um `return` sem
    // `showNotification` mataria a inscrição em silêncio.
    const pushStart = SW.indexOf('self.addEventListener("push"')
    const pushEnd = SW.indexOf('self.addEventListener("notificationclick"')
    const handler = SW.slice(pushStart, pushEnd)
    expect(handler).toMatch(/showNotification/)
    expect(handler).toMatch(/waitUntil/)
  })
})

describe('service worker — cache versionado', () => {
  it('declara CACHE_VERSION', () => {
    expect(SW).toMatch(/CACHE_VERSION\s*=\s*["']v\d+["']/)
  })

  it('apaga caches de versões anteriores no activate', () => {
    // Sem isto, um PWA instalado continua servindo o bundle antigo —
    // inclusive um service worker velho com o handler duplicado.
    expect(SW).toMatch(/caches\.keys\(\)/)
    expect(SW).toMatch(/caches\.delete/)
  })
})
