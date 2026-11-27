// ============================================================
// POST /api/adapto/conversations/start
//
// Garante uma conversa aberta para um contato da conta atual, sem
// exigir envio prévio de template Meta.
//
//   - Já existe conversa para o contato → devolve o id (reabrindo se
//     estiver com status 'closed').
//   - Ainda não existe → cria uma conversa com `status = 'open'` e o
//     `kind` compatível com o contato ('direct' ou 'group').
//
// Papel mínimo `agent` (mesmo portão do envio de mensagens e da RLS
// `conversations_insert`).
// ============================================================

import { NextResponse } from 'next/server';

import {
  requireRole,
  UnauthorizedError,
  ForbiddenError,
} from '@/lib/auth/account';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { getT } from '@/lib/i18n/translate';
import { conversationKindForContactPhone } from '@/adapto/inbox/start-conversation';

const t = getT('Api');

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const body = (await request.json().catch(() => null)) as {
      contact_id?: unknown;
    } | null;
    const contactId =
      typeof body?.contact_id === 'string' ? body.contact_id.trim() : '';

    if (!contactId) {
      return NextResponse.json(
        { error: t('send.idsRequired') },
        { status: 400 },
      );
    }

    const { data: contact, error: contactErr } = await ctx.supabase
      .from('contacts')
      .select('id, phone')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (contactErr) throw new Error(contactErr.message);
    if (!contact) {
      return NextResponse.json(
        { error: t('send.contactNotFound') },
        { status: 404 },
      );
    }

    const findExisting = async () => {
      const { data, error } = await ctx.supabase
        .from('conversations')
        .select('id, status')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contactId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as { id: string; status: string | null } | null;
    };

    const existing = await findExisting();
    if (existing) {
      if (existing.status === 'closed') {
        await reopenClosedConversation(ctx.supabase, existing);
      }
      return NextResponse.json({
        conversationId: existing.id,
        created: false,
      });
    }

    const { data: created, error: insertErr } = await ctx.supabase
      .from('conversations')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        contact_id: contactId,
        status: 'open',
        kind: conversationKindForContactPhone(contact.phone),
      })
      .select('id')
      .single();

    if (insertErr) {
      if (isUniqueViolation(insertErr)) {
        const raced = await findExisting();
        if (raced) {
          if (raced.status === 'closed') {
            await reopenClosedConversation(ctx.supabase, raced);
          }
          return NextResponse.json({
            conversationId: raced.id,
            created: false,
          });
        }
      }
      throw new Error(insertErr.message);
    }

    return NextResponse.json({
      conversationId: created.id,
      created: true,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[adapto/conversations/start]', err);
    return NextResponse.json({ error: t('internal') }, { status: 500 });
  }
}
