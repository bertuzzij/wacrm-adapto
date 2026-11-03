// ============================================================
// /api/adapto/conversations/[id]
//
//   DELETE — apaga a conversa e tudo que pende dela.
//
// O que acontece no banco (verificado contra o schema real):
//
//   messages            ON DELETE CASCADE   -> apagadas junto
//   message_reactions   ON DELETE CASCADE   -> apagadas junto
//   notifications       ON DELETE CASCADE   -> apagadas junto
//   ai_usage_log        ON DELETE SET NULL  -> linha de custo preservada
//   flow_runs           ON DELETE SET NULL  -> histórico de automação preservado
//   deals               ON DELETE NO ACTION  -> BLOQUEIA o delete
//
// `deals` é o único que impede: um negócio aponta para a conversa e o
// Postgres recusa a exclusão. Em vez de deixar estourar um erro de FK na
// cara do usuário, o vínculo é desfeito antes (`conversation_id = NULL`)
// e o negócio CONTINUA existindo, com o histórico de vendas intacto.
// Apagar um negócio junto com a conversa destruiria dado comercial, que é
// exatamente o que ninguém quer ao limpar a caixa de entrada.
//
// Irreversível, por isso é DELETE explícito (nunca GET) e a UI pede
// confirmação. Papel mínimo `agent`, igual à política RLS já existente em
// conversations (017): quem pode atender pode limpar.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { getT } from '@/lib/i18n/translate';

const t = getT('Api');

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: conversationId } = await params;

    // Confirma que a conversa existe E é da conta do chamador. A RLS já
    // cobriria o segundo caso, mas checar aqui permite devolver 404 em vez
    // de um "sucesso" que não apagou nada — a UI precisa saber a diferença.
    const { data: conversation, error: findErr } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (findErr) throw new Error(findErr.message);
    if (!conversation) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // Desfaz o vínculo com negócios. `deals.conversation_id` é NO ACTION,
    // então sem isto o DELETE abaixo falha com violação de FK.
    const { error: unlinkErr } = await ctx.supabase
      .from('deals')
      .update({ conversation_id: null })
      .eq('conversation_id', conversationId)
      .eq('account_id', ctx.accountId);

    if (unlinkErr) throw new Error(unlinkErr.message);

    const { error: delErr } = await ctx.supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId);

    if (delErr) throw new Error(delErr.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[adapto/conversations/delete]', err);
    return NextResponse.json({ error: t('internal') }, { status: 500 });
  }
}
