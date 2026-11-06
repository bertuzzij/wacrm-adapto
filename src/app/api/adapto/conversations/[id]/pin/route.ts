// ============================================================
// /api/adapto/conversations/[id]/pin
//
//   POST — fixa a conversa no topo da inbox.
//   DELETE — desafixa.
//
// Por que um endpoint e não um `update` do cliente: fixar é uma ação de
// LISTA, tomada de fora da conversa. O cliente tem RLS e poderia fazer o
// update direto, mas a inbox carrega as conversas sem `pinned_at` em
// algumas consultas e o optimistic update ficaria inconsistente entre a
// lista e o thread. Um endpoint único mantém a coluna sendo escrita num só
// lugar.
//
// Papel mínimo `agent`: quem atende decide o que fica à mão. É a mesma
// régua da política de UPDATE em `conversations` (migração 017).
//
// `pinned_at` guarda o instante, não um booleano, para que várias fixadas
// tenham ordem definida (a fixada mais recentemente primeiro).
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { getT } from '@/lib/i18n/translate';

const t = getT('Api');

async function setPinned(
  conversationId: string,
  pinnedAt: string | null
): Promise<Response> {
  const ctx = await requireRole('agent');

  const { data: conversation, error: findErr } = await ctx.supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('account_id', ctx.accountId)
    .maybeSingle();

  if (findErr) {
    console.error('[pin] lookup failed:', findErr);
    return NextResponse.json({ error: t('common.internalServerError') }, { status: 500 });
  }

  // 404 e não "sucesso silencioso": a lista precisa distinguir "fixei" de
  // "tentei fixar algo que não existe (ou não é meu)".
  if (!conversation) {
    return NextResponse.json({ error: t('conversations.notFound') }, { status: 404 });
  }

  const { error: updateErr } = await ctx.supabase
    .from('conversations')
    .update({ pinned_at: pinnedAt, updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('account_id', ctx.accountId);

  if (updateErr) {
    console.error('[pin] update failed:', updateErr);
    return NextResponse.json({ error: t('common.internalServerError') }, { status: 500 });
  }

  return NextResponse.json({ pinned_at: pinnedAt });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return await setPinned(id, new Date().toISOString());
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: t('common.unauthorized') }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: t('common.forbidden') }, { status: 403 });
    }
    console.error('[pin] unexpected:', err);
    return NextResponse.json({ error: t('common.internalServerError') }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return await setPinned(id, null);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: t('common.unauthorized') }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: t('common.forbidden') }, { status: 403 });
    }
    console.error('[pin] unexpected:', err);
    return NextResponse.json({ error: t('common.internalServerError') }, { status: 500 });
  }
}
