// ============================================================
// /api/adapto/conversations/[id]/read
//
//   POST — marca a conversa como lida no WhatsApp.
//
// Dois efeitos distintos, que antes só aconteciam juntos por acidente:
//
//   1. `conversations.unread_count = 0` — o badge do CRM. Já era feito
//      pelo cliente ao abrir a conversa (efeito em message-thread.tsx).
//
//   2. `POST /api/sendSeen` no WAHA — o tique azul do lado do contato.
//      NUNCA era feito ao abrir a conversa. `sendSeen` só saía pelo
//      `wahaTyping()`, que por sua vez só é chamado pela auto-resposta da
//      IA (auto-reply.ts). Quem lia manualmente deixava o contato vendo
//      "não lida" para sempre.
//
// Por que aqui e não no cliente: a chave da API do WAHA não pode ir para o
// navegador, e o cliente não deve falar direto com o servidor do WhatsApp.
//
// Falha do WAHA não derruba o endpoint: o ponto 1 (o CRM) sempre acontece.
// Se o WhatsApp estiver fora, o badge interno ainda precisa zerar —
// devolvemos `seen: false` e a tela não quebra.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { getT } from '@/lib/i18n/translate';
import { isWahaMode, toChatId, wahaSendSeen, WahaApiError } from '@/lib/whatsapp/waha';

const t = getT('Api');

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Qualquer membro que enxerga o inbox pode marcar como lido — é o
    // equivalente a abrir a conversa no celular, não uma ação de admin.
    const ctx = await requireRole('agent');

    // Abrir conversa é frequente: o balde acompanha `whatsappMedia`
    // (240/min), não o de admin. Ele existe para impedir que um bug de
    // loop no cliente martele o sendSeen do WhatsApp, não para limitar
    // o trabalho normal de quem atende.
    const limit = checkRateLimit(
      `adapto:read:${ctx.userId}`,
      RATE_LIMITS.whatsappMedia
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id: conversationId } = await params;

    // A conversa precisa ser da conta do chamador. Sem isso, um id
    // adivinhado deixaria qualquer membro marcar conversa alheia.
    const { data: conversation, error } = await ctx.supabase
      .from('conversations')
      .select('id, contact:contacts(phone, wa_user_id)')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!conversation) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // 1) Estado interno. Sempre, mesmo em modo Meta.
    const { error: updErr } = await ctx.supabase
      .from('conversations')
      .update({ unread_count: 0 })
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId);
    if (updErr) throw new Error(updErr.message);

    // 2) Avisar o WhatsApp. Só existe em modo WAHA, e é best-effort.
    let seen = false;
    if (isWahaMode()) {
      const contact = Array.isArray(conversation.contact)
        ? conversation.contact[0]
        : conversation.contact;
      // O LID do WhatsApp novo identifica o chat de forma mais confiável
      // que o telefone; `toChatId` preserva o `@` quando já existe.
      const target = contact?.wa_user_id?.trim() || contact?.phone?.trim() || '';
      if (target) {
        try {
          await wahaSendSeen(toChatId(target));
          seen = true;
        } catch (err) {
          // Log com o status, sem o corpo cru: a resposta do WAHA pode
          // conter o id do chat e o link do webhook.
          console.error(
            '[adapto/read] sendSeen falhou:',
            err instanceof WahaApiError ? err.httpStatus : 'sem_status'
          );
        }
      }
    }

    return NextResponse.json({ ok: true, seen });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[adapto/read]', err);
    return NextResponse.json({ error: t('internal') }, { status: 500 });
  }
}
