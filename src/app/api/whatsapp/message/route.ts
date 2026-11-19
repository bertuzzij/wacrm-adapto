import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isWahaMode, wahaDeleteMessage } from '@/lib/whatsapp/waha';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { getT } from '@/lib/i18n/translate';

const t = getT('Api');

/**
 * DELETE /api/whatsapp/message
 *
 * Body: { message_id: <internal UUID> }
 *
 * Apaga a mensagem do WhatsApp (para todos os participantes) e marca a
 * linha no banco como apagada — o texto some da bolha, que passa a exibir
 * o rótulo "mensagem apagada".
 *
 * Regras do WhatsApp, aplicadas aqui:
 *   - só mensagens do PRÓPRIO número podem ser apagadas
 *     (`sender_type = 'agent' | 'bot'`);
 *   - a mensagem precisa já ter sido enviada (tem `message_id` da Meta/WAHA).
 *
 * Só existe em modo WAHA: a rota Meta Cloud API não expõe delete nesta
 * integração (o upstream só implementa reação/envio).
 */
export async function DELETE(request: Request) {
  try {
    if (!isWahaMode()) {
      return NextResponse.json(
        { error: t('delete.wahaOnly') },
        { status: 400 },
      );
    }

    const { supabase, userId } = await requireRole('agent');

    const limit = checkRateLimit(`delete-message:${userId}`, RATE_LIMITS.react);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = (await request.json()) as { message_id?: string };
    const { message_id } = body;

    if (!message_id) {
      return NextResponse.json(
        { error: t('delete.idRequired') },
        { status: 400 },
      );
    }

    // Mensagem + conversa, com verificação de posse (a conta manda).
    const { data: target, error: msgError } = await supabase
      .from('messages')
      .select('id, message_id, sender_type, conversation_id')
      .eq('id', message_id)
      .maybeSingle();

    if (msgError || !target) {
      return NextResponse.json(
        { error: t('delete.messageNotFound') },
        { status: 404 },
      );
    }

    // Só a própria mensagem do atendente/bot. Mensagem de cliente não é
    // apagável pelo WhatsApp de quem atende.
    if (target.sender_type === 'customer') {
      return NextResponse.json(
        { error: t('delete.customerMessage') },
        { status: 403 },
      );
    }

    if (!target.message_id) {
      return NextResponse.json(
        { error: t('delete.notSent') },
        { status: 400 },
      );
    }

    // Apaga no WhatsApp primeiro: se falhar aí, o banco fica intacto e o
    // usuário pode tentar de novo. O contrário deixaria uma "mensagem
    // apagada" no CRM que ainda existe no celular do cliente.
    try {
      await wahaDeleteMessage({ messageId: target.message_id });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('delete.unknownWahaError');
      console.error('[whatsapp/delete] WAHA failed:', message);
      return NextResponse.json(
        { error: t('delete.wahaError', { message }) },
        { status: 502 },
      );
    }

    // Marca no banco. O registro fica (histórico de que houve mensagem e
    // quando), e a UI mostra o rótulo em vez do texto.
    const now = new Date().toISOString();
    const { error: updError } = await supabase
      .from('messages')
      .update({
        content_text: null,
        content_type: 'deleted',
        deleted_at: now,
      })
      .eq('id', target.id);

    if (updError) {
      console.error('[whatsapp/delete] DB update failed:', updError.message);
      return NextResponse.json(
        { error: t('delete.dbFailed') },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in WhatsApp message DELETE:', error);
    return toErrorResponse(error);
  }
}
