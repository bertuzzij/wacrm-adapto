// ============================================================
// /api/adapto/contacts/sync
//
//   POST — importa nome e foto dos contatos a partir do WhatsApp (WAHA).
//
// Por que POST e não GET: a operação grava no banco e baixa imagens. Um GET
// poderia disparar por prefetch, refresh ou crawler e sair mexendo em
// centenas de contatos sem ninguém pedir.
//
// Só admin: a sincronização reescreve dados de contato de todo o workspace.
// Um membro comum não deve poder disparar isso.
//
// Não há endpoint de escrita no WhatsApp. Este fluxo é de mão única
// (WhatsApp -> CRM) e não altera o que os contatos veem.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { getT } from '@/lib/i18n/translate';
import { isWahaMode } from '@/lib/whatsapp/waha';
import { syncContactProfiles } from '@/adapto/contact-sync/sync';

const t = getT('Api');

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    // A sincronização faz uma chamada ao WAHA por contato. O balde protege
    // o servidor do WhatsApp de um clique repetido, não o nosso.
    const limit = checkRateLimit(
      `adapto:contacts:sync:${ctx.userId}`,
      RATE_LIMITS.whatsappAdmin
    );
    if (!limit.success) return rateLimitResponse(limit);

    // Sem WAHA não há de onde importar. Dizer isso explicitamente é melhor
    // que devolver zeros e deixar a pessoa achando que rodou e não achou nada.
    if (!isWahaMode()) {
      return NextResponse.json({ error: 'not_in_waha_mode' }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as { limit?: unknown };
    const requested = Number(body?.limit);
    const limitCount =
      Number.isFinite(requested) && requested > 0 ? Math.min(requested, 200) : undefined;

    const result = await syncContactProfiles(ctx.supabase, ctx.accountId, {
      limit: limitCount,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[adapto/contacts/sync]', err);
    return NextResponse.json({ error: t('internal') }, { status: 500 });
  }
}
