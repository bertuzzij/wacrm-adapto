// ============================================================
// /api/adapto/conversations/[id]/members
//
//   GET — membros de um grupo, para o seletor de menção.
//
// Por que uma rota e não o cliente falando direto com o WAHA: a chave da
// API do WAHA nunca chega ao navegador. O componente pede a lista aqui, e
// só o servidor conhece a credencial.
//
// Devolve lista vazia (não erro) para conversa individual: a UI chama sem
// saber o tipo, e "não é grupo" não é falha.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { getT } from '@/lib/i18n/translate';
import { fetchGroupMembers } from '@/adapto/whatsapp-groups/server';
import { groupChatIdFromPhoneKey } from '@/adapto/whatsapp-groups/identity';

const t = getT('Api');

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id: conversationId } = await params;

    // A chave `group:<jid>` mora em `contacts.phone`; o contato vem junto
    // com a conversa. Um JOIN aqui evita duas idas ao banco e deixa claro
    // que só grupo tem membros.
    const { data: conversation, error } = await ctx.supabase
      .from('conversations')
      .select('id, kind, contact:contacts(phone)')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[members] lookup failed:', error);
      return NextResponse.json(
        { error: t('common.internalServerError') },
        { status: 500 }
      );
    }

    if (!conversation) {
      return NextResponse.json({ error: t('conversations.notFound') }, { status: 404 });
    }

    const phone = (conversation as { contact?: { phone?: string | null } | null })
      .contact?.phone;
    const groupJid = groupChatIdFromPhoneKey(phone);

    // Conversa individual: não há membros a mencionar.
    if (conversation.kind !== 'group' || !groupJid) {
      return NextResponse.json({ members: [] });
    }

    const members = await fetchGroupMembers(groupJid);
    return NextResponse.json({ members });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: t('common.unauthorized') }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: t('common.forbidden') }, { status: 403 });
    }
    console.error('[members] unexpected:', err);
    return NextResponse.json(
      { error: t('common.internalServerError') },
      { status: 500 }
    );
  }
}
