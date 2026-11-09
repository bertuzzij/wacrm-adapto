import { NextResponse } from 'next/server'
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
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  // A conta vem do PERFIL, não do corpo — ver o comentário no topo.
  const { data: profile, error: profileError } = await supabaseAdmin()
    .from('profiles')
    .select('account_id')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profile?.account_id) {
    return NextResponse.json({ error: 'Account not found' }, { status: 400 })
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
        account_id: profile.account_id,
        user_id: user.id,
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

export async function DELETE(request: Request) {
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
