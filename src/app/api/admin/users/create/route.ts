// ============================================================
// POST /api/admin/users/create — o owner cria um membro com email +
// senha temporária, direto em auth.users. Substitui o fluxo de convite
// (que dependia de email entregue e do Site URL correto do Supabase).
//
// SEGURANÇA (mesmas camadas da rota de redefinição):
//   1. Sessão + papel owner (server client; nunca por header).
//   2. Papel do novo membro restrito a admin/agent/viewer — owner não
//      é criável (uma conta tem um dono).
//   3. Rate limit por owner.
//   4. A senha em claro só existe no body HTTPS e dentro da função SQL
//      (bcrypt cost 10, byte-compatível com o GoTrue). Nunca logada.
//   5. Email duplicado → 409, com a mensagem do banco propagada.
//   6. A função é atômica: cria auth.users, reaproveita o trigger 017
//      (profile + conta pessoal), move o profile para a conta do owner
//      com o papel, e apaga a conta pessoal órfã.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getT } from '@/lib/i18n/translate';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { isValidEmail, validatePassword } from '@/adapto/admin-password/rules';

const t = getT('Api');

const CREATE_MEMBER_LIMIT = { limit: 10, windowMs: 15 * 60_000 };

const CREATE_MEMBER_SQL =
  'SELECT public.admin_create_member($1, $2, $3, $4, $5) AS user_id';

export async function POST(request: Request) {
  try {
    // 1. Sessão + papel.
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
      return NextResponse.json({ error: t('common.forbidden') }, { status: 403 });
    }

    // 2. Rate limit por owner.
    const limit = checkRateLimit('admin:createMember', CREATE_MEMBER_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    // 3. Payload.
    const payload = (await request.json().catch(() => null)) as {
      email?: string;
      password?: string;
      role?: string;
      fullName?: string;
    } | null;

    const email = (payload?.email ?? '').trim().toLowerCase();
    const password = typeof payload?.password === 'string' ? payload.password : '';
    const role = (payload?.role ?? '').trim();
    const fullName = (payload?.fullName ?? '').trim().slice(0, 120);

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: t('common.invalidEmail') }, { status: 400 });
    }
    const check = validatePassword(password);
    if (!check.ok) {
      return NextResponse.json(
        { error: t('common.passwordTooShort') },
        { status: 400 }
      );
    }
    if (!['admin', 'agent', 'viewer'].includes(role)) {
      return NextResponse.json({ error: t('account.members.roleInvalid') }, { status: 400 });
    }

    // 4. SQL direto (service role).
    const dbUrl = process.env.SUPABASE_DB_URL;
    if (!dbUrl) {
      console.error('[admin-create] SUPABASE_DB_URL not configured');
      return NextResponse.json(
        { error: t('common.serviceUnavailable') },
        { status: 503 }
      );
    }

    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: dbUrl });
    try {
      await client.connect();
      const result = await client.query(CREATE_MEMBER_SQL, [
        email,
        password,
        role,
        accountId,
        fullName,
      ]);
      const newUserId: string | null = result.rows[0]?.user_id ?? null;
      if (!newUserId) {
        return NextResponse.json(
          { error: t('account.members.createFailed') },
          { status: 500 }
        );
      }
    } catch (sqlError) {
      const message = sqlError instanceof Error ? sqlError.message : '';
      // 23505 = unique_violation: email já cadastrado (em auth.users).
      if ((sqlError as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: t('account.members.emailTaken') },
          { status: 409 }
        );
      }
      console.error('[admin-create] SQL failed:', message);
      return NextResponse.json(
        { error: t('account.members.createFailed') },
        { status: 500 }
      );
    } finally {
      await client.end().catch(() => {});
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error('[admin-create] failed:', error);
    return NextResponse.json(
      { error: t('common.internalServerError') },
      { status: 500 }
    );
  }
}
