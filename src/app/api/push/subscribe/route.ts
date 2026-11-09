import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  UnauthorizedError,
} from '@/lib/auth/account'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/**
 * Inscrição de Web Push deste aparelho.
 *
 *   POST   { endpoint, keys: { p256dh, auth }, userAgent? }  → inscreve
 *   DELETE { endpoint }                                       → remove
 *
 * Por que via route handler e não direto do navegador no Supabase: a
 * inscrição precisa gravar `account_id`, e deixar o cliente escolher a
 * conta seria abrir a porta para se inscrever na conta de outra pessoa.
 * O `account_id` é resolvido aqui, a partir do perfil de quem está
 * autenticado — nunca do corpo da requisição.
 */

interface SubscribeBody {
  endpoint?: unknown
  keys?: { p256dh?: unknown; auth?: unknown }
  userAgent?: unknown
}

/**
 * O endpoint é uma URL https do serviço de push. Validar a forma não é
 * paranoia: um endpoint inválido fica no banco e faz cada envio falhar
 * com 400, gastando tempo do webhook para sempre.
 */
function validEndpoint(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > 2000) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
  } catch {
    return false
  }
}

function validKey(value: unknown): value is string {
  // Chaves são base64url; limites generosos mas finitos.
  return typeof value === 'string' && value.length > 0 && value.length <= 200
}

export async function POST(request: Request) {
  // Usa o resolvedor de conta do projeto em vez de consultar `profiles` à
  // mão.
  //
  // Isto já foi um bug: a primeira versão fazia
  // `.from('profiles').eq('id', user.id)` — mas `profiles.id` é a PK da
  // linha (um uuid próprio), e o vínculo com `auth.users` é
  // `profiles.user_id`. A consulta compila, não acha nada, e a rota
  // responde "Account not found" para todo mundo. Exatamente o erro que o
  // usuário viu ao ligar o switch.
  //
  // `getCurrentAccount()` já faz essa consulta com a coluna certa e lança
  // UnauthorizedError/ForbiddenError tipados, que mapeamos abaixo.
  let account: Awaited<ReturnType<typeof getCurrentAccount>>
  try {
    account = await getCurrentAccount()
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[push] account resolution failed:', err)
    return NextResponse.json({ error: 'Account not found' }, { status: 403 })
  }

  let body: SubscribeBody
  try {
    body = (await request.json()) as SubscribeBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!validEndpoint(body.endpoint)) {
    return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 })
  }
  if (!validKey(body.keys?.p256dh) || !validKey(body.keys?.auth)) {
    return NextResponse.json({ error: 'Invalid keys' }, { status: 400 })
  }

  const userAgent =
    typeof body.userAgent === 'string'
      ? // Guarda só o necessário para o usuário reconhecer o aparelho.
        body.userAgent.slice(0, 255)
      : request.headers.get('user-agent')?.slice(0, 255) ?? null

  // `onConflict: endpoint` porque o navegador reenvia a mesma inscrição
  // com chaves possivelmente rotacionadas. Sem isto, cada reenvio
  // criaria outra linha e o usuário receberia o mesmo aviso N vezes.
  const { error } = await supabaseAdmin()
    .from('push_subscriptions')
    .upsert(
      {
        account_id: account.accountId,
        user_id: account.userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        user_agent: userAgent,
      },
      { onConflict: 'endpoint' },
    )

  if (error) {
    console.error('[push] subscribe failed:', error.message)
    return NextResponse.json({ error: 'Could not save subscription' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

/**
 * Este aparelho está registrado no servidor?
 *
 * A UI precisa desta resposta para não mentir. O navegador pode ter uma
 * inscrição que o banco não conhece (falha de rede depois do `subscribe()`,
 * troca de conta no mesmo aparelho, limpeza do banco). Nesse caso o switch
 * aparecia "Ativo" e nenhum push chegava nunca.
 *
 * Compara o `endpoint` da inscrição atual com o que está gravado para este
 * usuário: existir QUALQUER inscrição do usuário não basta — pode ser de
 * outro aparelho.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const endpoint = url.searchParams.get('endpoint')

  if (!validEndpoint(endpoint)) {
    return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 })
  }

  let account: Awaited<ReturnType<typeof getCurrentAccount>>
  try {
    account = await getCurrentAccount()
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Account not found' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin()
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', endpoint)
    .eq('user_id', account.userId)
    .maybeSingle()

  if (error) {
    console.error('[push] lookup failed:', error.message)
    // `registered: false` em vez de 500: a UI trata como "ative de novo",
    // que é a ação correta também.
    return NextResponse.json({ registered: false })
  }

  return NextResponse.json({ registered: Boolean(data) })
}

export async function DELETE(request: Request) {
  // Aqui basta o id do usuário (a remoção filtra por `user_id`), então não
  // precisa resolver a conta — usar `getCurrentAccount` recusaria a remoção
  // de um perfil ainda não vinculado, deixando a inscrição órfã no banco.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { endpoint?: unknown }
  try {
    body = (await request.json()) as { endpoint?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!validEndpoint(body.endpoint)) {
    return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 })
  }

  // Filtra por user_id também: sem isto, conhecer o endpoint de outro
  // aparelho bastaria para desligar o aviso dele.
  const { error } = await supabaseAdmin()
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', body.endpoint)
    .eq('user_id', user.id)

  if (error) {
    console.error('[push] unsubscribe failed:', error.message)
    return NextResponse.json({ error: 'Could not remove subscription' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
