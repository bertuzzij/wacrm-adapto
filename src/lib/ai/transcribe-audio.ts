// ============================================================
// Transcrição de áudio via Groq (Whisper large-v3).
//
// ## Por que Groq e não o WAHA
//
// O engine GOWS desta instalação não expõe transcrição (todas as rotas
// `…/transcribe` respondem 404 — testado contra a sessão real). A Groq
// resolve no lado do CRM: baixa o áudio pelo proxy que já existe e envia
// ao Whisper, sem mudar nada no WhatsApp.
//
// ## A chave
//
// Reusa a configuração de IA da conta (`ai_configs`): quem configurou a
// Groq como provider `openai_compatible` com base_url
// `https://api.groq.com/openai/v1` já tem a chave criptografada no banco.
// `loadAiConfig` resolve e decripta; esta função só aceita Groq (host
// `api.groq.com`) porque o Whisper é endpoint próprio — um provider
// OpenAI comum não teria `/transcriptions`.
//
// ## Retenção
//
// O áudio é enviado à Groq para transcrição e NÃO é persistido lá (a API
// de audio-transcriptions não retém o arquivo). O texto vira parte da
// mensagem? Não — fica na resposta da requisição apenas, para o
// atendente ler. Persistir no banco seria nova coluna + decisão de
// produto (o texto transcrito é dado do cliente).
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { loadAiConfig } from '@/lib/ai/config'
import { AiError } from '@/lib/ai/types'

/** Tamanho máximo de áudio aceito pela Groq (25 MB, com folha). */
const MAX_AUDIO_BYTES = 24 * 1024 * 1024

/** MIME types que a Groq aceita. */
const SUPPORTED_TYPES = new Set([
  'audio/ogg',
  'audio/opus',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/webm',
  'audio/wav',
])

function groqBaseUrl(baseUrl: string | null): string | null {
  if (!baseUrl) return null
  try {
    const host = new URL(baseUrl).host
    return host === 'api.groq.com' ? 'https://api.groq.com/openai/v1' : null
  } catch {
    return null
  }
}

export interface TranscriptionResult {
  text: string
  durationMs: number
}

/**
 * Transcreve o áudio de uma mensagem.
 *
 * Lança `AiError` com mensagem pronta para a UI em cada falha — o
 * chamador não precisa distinguir causa.
 */
export async function transcribeMessageAudio(
  accountId: string,
  mediaUrl: string,
  mimeType: string | null,
): Promise<TranscriptionResult> {
  const started = Date.now()

  // 1. Config de IA da conta — a Groq é um openai_compatible com host certo.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const config = await loadAiConfig(supabase, accountId, {
    // A transcrição não depende do auto-reply estar ligado.
    requireActive: false,
  })

  if (!config?.apiKey) {
    throw new AiError('Configuração de IA não encontrada', { code: "aiNotConfigured" })
  }

  const groq = groqBaseUrl(config.baseUrl)
  if (!groq) {
    throw new AiError(
      'A transcrição usa a Groq — configure o provider openai_compatible com base_url https://api.groq.com/openai/v1',
      { code: 'notGroq' },
    )
  }

  // 2. Baixa o áudio do proxy (credenciado pela conta de serviço).
  const audioRes = await fetch(mediaUrl, {
    signal: AbortSignal.timeout(120_000),
  })
  if (!audioRes.ok) {
    throw new AiError(`Falha ao baixar o áudio (${audioRes.status})`, { code: "audioFetchFailed" })
  }
  const bytes = Buffer.from(await audioRes.arrayBuffer())
  if (bytes.length === 0) {
    throw new AiError('O arquivo de áudio está vazio', { code: "audioEmpty" })
  }
  if (bytes.length > MAX_AUDIO_BYTES) {
    throw new AiError('O áudio passa de 24 MB', { code: "audioTooLarge" })
  }

  const mime = (mimeType ?? 'audio/ogg').split(';')[0]
  if (!SUPPORTED_TYPES.has(mime)) {
    throw new AiError(`Tipo de áudio não suportado (${mime})`, { code: "audioTypeUnsupported" })
  }

  // 3. Envia à Groq. O modelo Whisper large-v3 é o mais preciso da casa;
  //    a resposta é JSON { text }.
  const form = new FormData()
  form.append(
    'file',
    new Blob([bytes], { type: mime }),
    `audio.${mime.split('/')[1] ?? 'ogg'}`,
  )
  form.append('model', 'whisper-large-v3')

  const groqRes = await fetch(`${groq}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  })

  if (!groqRes.ok) {
    const body = await groqRes.text().catch(() => '')
    console.error('[transcribe] Groq failed:', groqRes.status, body.slice(0, 200))
    if (groqRes.status === 401) {
      throw new AiError('A chave da Groq foi recusada', { code: "groqAuthFailed" })
    }
    throw new AiError(`A Groq recusou a transcrição (${groqRes.status})`, { code: "groqFailed" })
  }

  const data = (await groqRes.json()) as { text?: string }
  const text = (data.text ?? '').trim()

  if (!text) {
    throw new AiError('A transcrição veio vazia (áudio em silêncio?)', { code: "emptyTranscription" })
  }

  return { text, durationMs: Date.now() - started }
}
