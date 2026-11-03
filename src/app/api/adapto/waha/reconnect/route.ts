// ============================================================
// /api/adapto/waha/reconnect
//
//   POST — coloca a sessão num estado em que o QR possa ser lido.
//
//   body { action: 'reconnect' }   → start (se STOPPED) ou restart
//
// Por que POST e não GET: muda estado no servidor do WhatsApp. Um GET
// poderia ser disparado por prefetch de link, histórico do navegador ou
// um simples refresh — e reiniciar a sessão de todo mundo sem intenção.
//
// Por que admin: a ação afeta o WhatsApp do workspace inteiro. Um membro
// comum que derruba a conexão no meio do expediente é um problema que o
// dono da conta precisa conseguir evitar.
//
// O que este endpoint NÃO faz: `logout`. Logout apaga o pareamento e força
// escanear o QR do zero — destrutivo demais para ficar atrás de um botão
// que a pessoa aperta quando "a conexão caiu". `restart` recupera os casos
// em que a doc do WAHA recomenda exatamente isso (`FAILED`).
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { getT } from '@/lib/i18n/translate';
import {
  reconnect,
  waitForStatus,
  WahaTransportError,
} from '@/adapto/waha-connection/server';

const t = getT('Api');

export async function POST() {
  try {
    const ctx = await requireRole('admin');

    // Cada clique reinicia a sessão e derruba o pareamento em andamento,
    // então o balde é curto: dois cliques acidentais seguidos já são
    // demais. Por usuário, não por conta, para um admin não conseguir
    // consumir a cota de outro.
    const limit = checkRateLimit(
      `adapto:waha:reconnect:${ctx.userId}`,
      RATE_LIMITS.whatsappAdmin
    );
    if (!limit.success) return rateLimitResponse(limit);

    const result = await reconnect();

    // Depois do restart o WAHA leva alguns segundos para chegar em
    // SCAN_QR_CODE. Esperar aqui evita a tela mostrar "iniciando…" e
    // obrigar o usuário a clicar de novo; se estourar o prazo, devolvemos
    // o status atual e a tela continua se atualizando sozinha.
    const finalStatus =
      result.action === 'none'
        ? await waitForStatus((s) => s !== 'STARTING', 5_000)
        : await waitForStatus((s) => s === 'SCAN_QR_CODE' || s === 'WORKING', 30_000);

    return NextResponse.json({
      action: result.action,
      status: finalStatus,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof WahaTransportError) {
      return NextResponse.json(
        { error: err.kind },
        { status: err.kind === 'not_configured' ? 400 : 502 }
      );
    }
    console.error('[adapto/waha/reconnect]', err);
    return NextResponse.json({ error: t('internal') }, { status: 500 });
  }
}
