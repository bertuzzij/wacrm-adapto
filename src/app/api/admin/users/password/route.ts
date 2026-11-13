// ============================================================
// POST /api/admin/users/password — o owner redefine a senha de um usuário
// da própria conta, direto no auth.users, sem depender do email do
// Supabase.
//
// POR QUE ESTA ROTA EXISTE
//
// O email de reset do Supabase aponta para o Site URL configurado no
// painel; com a configuração errada, o link cai em localhost e o usuário
// fica travado. Este caminho independe de email e de painel.
//
// SEGURANÇA, EM CAMADAS:
//
//   1. Sessão obrigatória e papel `owner` — verificado pelo supabase
//      server client, nunca por header ou parâmetro.
//   2. Escopo: o usuário-alvo DEVE pertencer à MESMA conta do owner
//      (join em profiles). Um owner não alcança usuários de outra conta,
//      nem emails inexistentes recebem confirmação diferente.
//   3. Rate limit próprio: redefinição é operação rara; janela curta
//      bloqueia brute force mesmo com sessão válida.
//   4. A senha em claro NUNCA vira parâmetro de SQL logável nem entra em
//      log: vai direto para a função admin_set_user_password, que hash-eia
//      com crypt()/pgcrypto dentro do banco.
//   5. O usuário redefinido é deslogado (a função remove sessions e
//      refresh tokens) — re-login com a senha nova.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getT } from '@/lib/i18n/translate';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { isValidEmail, validatePassword } from '@/adapto/admin-password/rules';

const t = getT('Api');

/** Janela de 15 min, 5 tentativas por owner. */
const PASSWORD_RESET_LIMIT = { limit: 5, windowMs: 15 * 60_000 };

// pgcrypto cuida do hashing dentro do banco; a rota só passa o email e a
// senha em claro por HTTPS para a função, que nunca os loga.
const SET_PASSWORD_SQL = 'SELECT public.admin_set_user_password($1, $2) AS ok';

export async function POST(request: Request) {
  try {
    // ------------------------------------------------------------
    // 1. Sessão + papel.
    // ------------------------------------------------------------
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: t('common.unauthorized') }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id, account_role')
      .eq('user_id', user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;
    if (!accountId) {
      return NextResponse.json({ error: t('common.profileNotLinked') }, { status: 403 });
    }
    if (profile?.account_role !== 'owner') {
      // Resposta deliberadamente genérica: um não-owner não deve descobrir
      // que a rota existe nem diferenciar 401 de 403.
      return NextResponse.json({ error: t('common.forbidden') }, { status: 403 });
    }

    // ------------------------------------------------------------
    // 2. Rate limit por owner.
    // ------------------------------------------------------------
    const limit = checkRateLimit(
      `admin-password:${user.id}`,
      PASSWORD_RESET_LIMIT
    );
    if (!limit.success) return rateLimitResponse(limit);

    // ------------------------------------------------------------
    // 3. Payload.
    // ------------------------------------------------------------
    const payload = (await request.json().catch(() => null)) as {
      email?: string;
      password?: string;
      confirmPassword?: string;
    } | null;

    const email = (payload?.email ?? '').trim().toLowerCase();
    const password = typeof payload?.password === 'string' ? payload.password : '';
    const confirm = typeof payload?.confirmPassword === 'string' ? payload.confirmPassword : undefined;

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: t('common.invalidEmail') }, { status: 400 });
    }
    const check = validatePassword(password, confirm);
    if (!check.ok) {
      const key =
        check.error === 'too-short' ? 'common.passwordTooShort'
        : check.error === 'mismatch' ? 'common.passwordsMismatch'
        : 'common.passwordRequired';
      return NextResponse.json({ error: t(key) }, { status: 400 });
    }

    // Auto-redefinição não passa por aqui: o usuário logado troca a própria
    // senha por updateUser (fluxo oficial). Bloquear evita o owner apagar
    // a própria sessão.
    if (email === (user.email ?? '').toLowerCase()) {
      return NextResponse.json(
        { error: t('common.ownPasswordUseProfile') },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------
    // 4. Escopo: o alvo pertence à conta do owner?
    // ------------------------------------------------------------
    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .eq('email', email)
      .maybeSingle();
    if (!targetProfile) {
      // Uniforme com "usuário inexistente": um owner não pode usar esta
      // rota para sondar quais emails existem fora da conta dele.
      return NextResponse.json({ error: t('common.userNotFound') }, { status: 404 });
    }

    // ------------------------------------------------------------
    // 5. Redefinição: SQL direto ao auth.users (service role).
    //    A senha em claro entra só aqui e morre dentro da função SQL.
    // ------------------------------------------------------------
    const dbUrl = process.env.SUPABASE_DB_URL;
    if (!dbUrl) {
      console.error('[admin-password] SUPABASE_DB_URL not configured');
      return NextResponse.json(
        { error: t('common.serviceUnavailable') },
        { status: 503 }
      );
    }

    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: dbUrl });
    try {
      await client.connect();
      const result = await client.query(SET_PASSWORD_SQL, [email, password]);
      const changed: boolean = result.rows[0]?.ok === true;

      if (!changed) {
        // O email passou no profiles mas não existe em auth.users: estado
        // inconsistente; resposta uniforme de "não encontrado".
        return NextResponse.json({ error: t('common.userNotFound') }, { status: 404 });
      }
    } finally {
      await client.end().catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[admin-password] failed:', error);
    return NextResponse.json(
      { error: t('common.internalServerError') },
      { status: 500 }
    );
  }
}
