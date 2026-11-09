import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guarda-corpo do mapeamento de conta nas rotas de push.
 *
 * ## O bug que isto impede
 *
 * A primeira versão de `/api/push/subscribe` resolvia a conta assim:
 *
 *     .from('profiles').select('account_id').eq('id', user.id)
 *
 * `profiles.id` é a PK da LINHA (um uuid próprio, gerado no insert), e o
 * vínculo com `auth.users` é `profiles.user_id`. A consulta compila, roda
 * sem erro e não encontra nada — então a rota respondia
 * `400 {"error":"Account not found"}` para todo mundo.
 *
 * O sintoma que o usuário viu foi o toast "Não foi possível ativar as
 * notificações — Account not found" com o switch voltando sozinho. Nenhum
 * teste pegou porque a rota não tinha teste, e o typecheck não vê semântica
 * de coluna.
 *
 * O mesmo erro já tinha aparecido no SQL da política de RLS (migração 068) e
 * foi corrigido lá — mas o TypeScript ficou para trás. Estes testes amarram
 * as DUAS pontas.
 */

const ROOT = process.cwd()

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8')
}

/**
 * Remove comentários antes de procurar o padrão do bug.
 *
 * Sem isto o teste dá falso positivo: o próprio comentário que EXPLICA o
 * erro contém a linha errada, e o regex a encontra. O que importa é o código
 * executável.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('resolução de conta nas rotas de push', () => {
  const route = stripComments(read('src/app/api/push/subscribe/route.ts'))

  it('não consulta profiles filtrando pela coluna errada', () => {
    // Qualquer `.from('profiles')...eq('id', …)` é suspeita: `profiles.id` é
    // a PK da linha, nunca o id do auth user. Não basta casar `user.id` —
    // uma variável intermediária (`const uid = user.id`) escaparia.
    const wrong = /from\(\s*['"]profiles['"]\s*\)[\s\S]{0,300}?\.eq\(\s*['"]id['"]\s*,/
    expect(route).not.toMatch(wrong)
  })

  it('não seleciona account_id de profiles à mão (use o resolvedor)', () => {
    // A rota não deve montar a própria consulta de conta: é assim que a
    // coluna errada entra. `getCurrentAccount()` já resolve user + conta +
    // papel, e é o único lugar onde `user_id` aparece.
    const manual = /from\(\s*['"]profiles['"]\s*\)[\s\S]{0,200}?\.select\([^)]*account_id/
    expect(route).not.toMatch(manual)
  })

  it('usa o resolvedor de conta do projeto', () => {
    // Uma implementação só, já correta, em vez de uma segunda consulta que
    // pode divergir de novo.
    expect(route).toMatch(/getCurrentAccount/)
  })

  it('grava account_id e user_id vindos do contexto resolvido', () => {
    expect(route).toMatch(/account_id:\s*account\.accountId/)
    expect(route).toMatch(/user_id:\s*account\.userId/)
  })
})

describe('política de RLS de push_subscriptions', () => {
  // A política foi escrita à mão em SQL e tinha o mesmo `id` no lugar de
  // `user_id`. As duas pontas precisam concordar.
  it('a política de INSERT casa a conta por profiles.user_id', () => {
    const sql = stripComments(read('supabase/migrations/068_fix_push_insert_policy.sql'))
    // Flag `i`: o SQL é escrito em maiúsculas (`WHERE`), o regex em
    // minúsculas. Sem ela o teste falharia num SQL correto.
    expect(sql).toMatch(/profiles\s+where\s+user_id\s*=\s*auth\.uid\(\)/i)
    expect(sql).not.toMatch(/profiles\s+where\s+id\s*=\s*auth\.uid\(\)/i)
  })

  it('a migração original não reintroduz a coluna errada', () => {
    const sql = stripComments(read('supabase/migrations/067_push_subscriptions.sql'))
    expect(sql).not.toMatch(/profiles\s+where\s+id\s*=\s*auth\.uid\(\)/i)
  })
})

describe('getCurrentAccount é a fonte de verdade da coluna', () => {
  it('consulta profiles por user_id, não por id', () => {
    // Se ESTE arquivo regredir, todo o app quebra — mas o ponto aqui é
    // documentar qual coluna é a certa para quem for escrever a próxima
    // rota.
    const source = read('src/lib/auth/account.ts')
    expect(source).toMatch(/\.from\(\s*["']profiles["']\s*\)[\s\S]{0,200}?\.eq\(\s*["']user_id["']\s*,\s*user\.id/)
  })
})
