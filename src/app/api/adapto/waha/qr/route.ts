// ============================================================
// /api/adapto/waha/qr
//
//   GET — PNG do QR de pareamento, em `data:` URL.
//
// Só responde quando o WAHA está de fato em `SCAN_QR_CODE`. Fora desse
// estado o endpoint do WAHA devolve 422, então devolvemos 409 com um
// código estável que a tela traduz em vez de mostrar "erro 422".
//
// O QR é um token de pareamento de vida curta (~20s). Ele não é segredo
// no sentido de credencial, mas também não vai para log nem para HTML
// renderizado: só trafega nesta resposta autenticada.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import {
  fetchQrDataUrl,
  fetchSession,
  WahaTransportError,
} from '@/adapto/waha-connection/server';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // O QR é renovado a cada ~20s enquanto a tela estiver aberta, então o
    // limite precisa ser generoso o bastante para não atrapalhar o
    // pareamento normal — mas finito, porque cada chamada custa uma ida ao
    // WAHA.
    const limit = checkRateLimit(
      `adapto:waha:qr:${ctx.userId}`,
      RATE_LIMITS.whatsappAdmin
    );
    if (!limit.success) return rateLimitResponse(limit);

    const session = await fetchSession();
    if (session.status.toUpperCase() !== 'SCAN_QR_CODE') {
      return NextResponse.json(
        { error: 'not_awaiting_qr', status: session.status },
        { status: 409 }
      );
    }

    const qr = await fetchQrDataUrl();
    if (!qr) {
      return NextResponse.json({ error: 'qr_unavailable' }, { status: 503 });
    }

    return NextResponse.json({
      dataUrl: qr.dataUrl,
      refreshInMs: qr.expiresHintMs,
    });
  } catch (err) {
    if (err instanceof WahaTransportError) {
      return NextResponse.json(
        { error: err.kind },
        { status: err.kind === 'not_configured' ? 400 : 502 }
      );
    }
    return toErrorResponse(err);
  }
}
