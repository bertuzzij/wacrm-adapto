// ============================================================
// /api/adapto/waha/status
//
//   GET — retrato da conexão WAHA para a tela de acompanhamento.
//
// Por que uma rota e não um Server Component que lê direto:
//   A tela precisa se atualizar sozinha (o QR gira a cada ~20s, o status
//   muda durante o pareamento) e precisa do botão de reconectar. Um Server
//   Component exigiria um `router.refresh()` para cada mudança e ainda
//   assim entregaria a chave do WAHA ao render — o que nunca deve acontecer.
//
// Qualquer membro do workspace pode ver o status. Só admin pode agir
// (ver /api/adapto/waha/reconnect).
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import {
  fetchCapping,
  fetchSession,
  fetchSessionRaw,
  WahaTransportError,
} from '@/adapto/waha-connection/server';
import { loadMessageCounts } from '@/adapto/waha-connection/metrics';
import {
  cappingUsagePercent,
  describeConflicts,
  describeStatus,
  formatPhoneFromJid,
} from '@/adapto/waha-connection/status';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // Mesmo bucket da checagem de saúde do WhatsApp no upstream: é a mesma
    // classe de operação (leitura que bate num serviço externo).
    const limit = checkRateLimit(
      `adapto:waha:status:${ctx.userId}`,
      RATE_LIMITS.whatsappHealth
    );
    if (!limit.success) return rateLimitResponse(limit);

    const session = await fetchSession();

    // Timelock e cota só fazem sentido com a sessão de pé.
    //
    // O timelock já veio no `/me` que `fetchSession` acabou de ler, então
    // usamos ele e não gastamos uma ida a mais na rede — `/timelock` só
    // existe em versões novas do WAHA e, quando existe, devolve o mesmo
    // dado. A cota, essa sim, precisa do endpoint dedicado (e vem `null`
    // na 2026.7.2, que não o expõe).
    const [timelock, capping] =
      session.status.toUpperCase() === 'WORKING'
        ? await Promise.all([
            Promise.resolve(session.reachoutTimelock),
            fetchCapping(),
          ])
        : [null, null];

    const view = describeStatus(session.status);

    // Métricas: WAHA + banco, em paralelo. Uma falha em qualquer lado
    // devolve `null` no campo, nunca derruba a resposta — a tela precisa
    // mostrar a conexão mesmo que a contagem não venha.
    const [raw, counts] = await Promise.all([
      fetchSessionRaw().catch(() => null),
      loadMessageCounts(ctx.supabase, ctx.accountId).catch(() => null),
    ]);

    return NextResponse.json({
      configured: true,
      session: {
        name: session.name,
        status: session.status,
        phone: formatPhoneFromJid(session.meId),
        pushName: session.pushName,
      },
      connection: {
        state: view.state,
        messageKey: view.messageKey,
        hintKey: view.hintKey,
        canFetchQr: view.canFetchQr,
        canReconnect: view.canReconnect,
      },
      metrics: {
        lastActivityAt: raw?.activityAt ?? null,
        engineConnected: raw?.engineConnected ?? null,
        received24h: counts?.received24h ?? null,
        sent24h: counts?.sent24h ?? null,
        failed24h: counts?.failed24h ?? null,
      },
      conflicts: describeConflicts({ timelock, capping }),
      cappingUsage: cappingUsagePercent(capping),
    });
  } catch (err) {
    // "Não configurado" e "fora do ar" não são erros do CRM: são estados
    // que a tela precisa saber mostrar. Um 500 genérico faria a tela dizer
    // "erro inesperado" quando a informação útil é "o servidor do WhatsApp
    // não respondeu".
    if (err instanceof WahaTransportError) {
      return NextResponse.json(
        {
          configured: err.kind !== 'not_configured',
          unreachable: err.kind === 'unreachable',
          error: err.kind,
        },
        { status: 200 }
      );
    }
    return toErrorResponse(err);
  }
}
