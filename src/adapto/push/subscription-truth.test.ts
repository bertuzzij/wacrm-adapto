import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * O switch de push não pode mentir.
 *
 * ## O bug que isto impede
 *
 * O usuário viu o pior estado possível: o toast "Não foi possível ativar as
 * notificações" E o switch verde dizendo "Ativo neste aparelho", ao mesmo
 * tempo, sem nenhum push chegar.
 *
 * A causa era assimetria entre as duas pontas. `subscribeToPush()` criava a
 * inscrição no NAVEGADOR e só depois tentava salvar no SERVIDOR. Quando o
 * POST falhava, a inscrição do navegador ficava órfã — e a UI, que só olhava
 * o navegador, lia "existe inscrição = ativo".
 *
 * Estado correto: o switch só fica ligado quando as DUAS pontas concordam.
 * Estes testes amarram isso ao código.
 */

const ROOT = process.cwd()

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8')
}

describe('subscribeToPush desfaz a inscrição quando o servidor recusa', () => {
  const client = read('src/adapto/push/client.ts')

  it('desfaz o subscribe() se o POST falhar', () => {
    // Sem o cleanup, a inscrição fica no navegador e a UI mostra "ativo"
    // para um aparelho que o servidor não conhece.
    expect(client).toMatch(/await subscription\.unsubscribe\(\)\.catch/)
  })

  it('desfaz também em erro de rede', () => {
    // O bloco de catch da requisição precisa do mesmo cleanup — erro de
    // rede é o caminho mais comum (app fechando, sinal caindo).
    const catchBlocks = client.split('catch {').length - 1
    const cleanups = client.split('subscription.unsubscribe().catch').length - 1
    // Pelo menos dois cleanups: um em `!response.ok`, um no catch de rede.
    expect(cleanups).toBeGreaterThanOrEqual(2)
    expect(catchBlocks).toBeGreaterThan(0)
  })
})

describe('o estado do switch vem do servidor, não só do navegador', () => {
  const card = read('src/adapto/push/push-card.tsx')
  const client = read('src/adapto/push/client.ts')

  it('existe uma verificação contra o servidor', () => {
    expect(client).toMatch(/isRegisteredOnServer/)
  })

  it('o card usa a verificação em vez de confiar no navegador', () => {
    // `setSubscribed(Boolean(existing))` era exatamente a linha que
    // produzia o "Ativo" falso.
    expect(card).toMatch(/isRegisteredOnServer/)
    expect(card).not.toMatch(/setSubscribed\(Boolean\(existing\)\)/)
  })

  it('a rota expõe GET para a verificação', () => {
    const route = read('src/app/api/push/subscribe/route.ts')
    expect(route).toMatch(/export async function GET/)
    // A checagem precisa ser POR APARELHO: ter outra inscrição do mesmo
    // usuário não prova que ESTE dispositivo está registrado.
    expect(route).toMatch(/\.eq\(\s*['"]endpoint['"]\s*,\s*endpoint\s*\)/)
  })
})
