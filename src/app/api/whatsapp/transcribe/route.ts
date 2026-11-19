import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { getT } from '@/lib/i18n/translate';
import { transcribeMessageAudio } from '@/lib/ai/transcribe-audio';
import { AiError } from '@/lib/ai/types';

const t = getT('Api');

/**
 * POST /api/whatsapp/transcribe
 *
 * Body: { message_id: <internal UUID> }
 *
 * Transcreve o áudio de uma mensagem usando a Groq configurada na conta
 * (provider openai_compatible + base_url api.groq.com).
 *
 * A transcrição NÃO é persistida: volta na resposta para o atendente ler.
 * Persistir seria decisão de produto (o texto é dado do cliente) e mudaria
 * a bolha de todos — não só do dispositivo que pediu.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');

    const limit = checkRateLimit(`transcribe:${userId}`, RATE_LIMITS.aiDraft);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = (await request.json()) as { message_id?: string };
    if (!body.message_id) {
      return NextResponse.json(
        { error: t('transcribe.idRequired') },
        { status: 400 },
      );
    }

    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select('id, content_type, media_url, media_type')
      .eq('id', body.message_id)
      .maybeSingle();

    if (msgError || !message) {
      return NextResponse.json(
        { error: t('transcribe.messageNotFound') },
        { status: 404 },
      );
    }

    if (message.content_type !== 'audio' || !message.media_url) {
      return NextResponse.json(
        { error: t('transcribe.notAudio') },
        { status: 400 },
      );
    }

    try {
      const result = await transcribeMessageAudio(
        accountId,
        message.media_url,
        message.media_type ?? null,
      );
      return NextResponse.json({
        text: result.text,
        durationMs: result.durationMs,
      });
    } catch (err) {
      if (err instanceof AiError) {
        // Erros conhecidos têm mensagem pronta para a UI.
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  } catch (error) {
    console.error('Error in WhatsApp transcribe:', error);
    return toErrorResponse(error);
  }
}
