import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { isWahaMode, isWahaMediaId, wahaStreamMedia } from '@/lib/whatsapp/waha'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getT } from '@/lib/i18n/translate'
import { mediaProxyHeaders } from '@/lib/media/proxy-response-headers'

const t = getT('Api')

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId) {
      return NextResponse.json(
        { error: t('media.idRequired') },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: t('common.unauthorized') },
        { status: 401 }
      )
    }

    const limit = checkRateLimit(`whatsapp-media:${user.id}`, RATE_LIMITS.whatsappMedia)
    if (!limit.success) return rateLimitResponse(limit)

    // Resolve the caller's account_id — whatsapp_config is one-per-
    // account post-multi-user, so a teammate fetching media for a
    // conversation in the shared inbox needs the account's config,
    // not their personal (non-existent) row.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: t('common.profileNotLinked') },
        { status: 403 },
      )
    }

    // Fetch and decrypt WhatsApp config
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        { error: t('common.whatsappNotConfigured') },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Get the download URL from Meta
    const mediaInfo = await getMediaUrl({ mediaId, accessToken })

    // ------------------------------------------------------------
    // STREAMING COM RANGE (caminho WAHA).
    //
    // O player de vídeo do navegador pede fatias (`Range: bytes=…`) para
    // começar a tocar antes de baixar tudo, e pede de novo ao arrastar a
    // barra de progresso. Sem repassar esse header, cada pedido virava um
    // download COMPLETO: `downloadMedia` chama `arrayBuffer()`, então um
    // vídeo de 300 MB passava inteiro pela RAM do servidor — às vezes
    // várias vezes na mesma sessão.
    //
    // O WAHA responde 206 com `Content-Range`, então basta repassar. A
    // `Response` vai sem tocar no corpo: os bytes fluem em stream.
    //
    // Só no modo WAHA: no caminho Meta a URL é um CDN de curta duração e
    // o download já era feito do mesmo jeito de sempre.
    if (isWahaMode() && isWahaMediaId(mediaId) && mediaInfo.url) {
      const upstream = await wahaStreamMedia(
        mediaInfo.url,
        request.headers.get('range'),
      )
      if (upstream.ok || upstream.status === 206) {
        const headers = mediaProxyHeaders(
          mediaId,
          upstream.headers.get('content-type') || mediaInfo.mimeType,
        )
        // Preserva os headers que fazem o player entender o fatiamento.
        // Sem `Content-Range` e `Accept-Ranges` o navegador não sabe que
        // pode buscar pedaços e volta a pedir o arquivo inteiro.
        const range = upstream.headers.get('content-range')
        if (range) headers['Content-Range'] = range
        const length = upstream.headers.get('content-length')
        if (length) headers['Content-Length'] = length
        if (upstream.status === 206) headers['Accept-Ranges'] = 'bytes'

        return new Response(upstream.body, {
          status: upstream.status,
          headers,
        })
      }
      // Cai no caminho antigo: melhor servir o arquivo inteiro do que
      // devolver erro para uma mídia que existe.
    }

    // Download the binary data
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    })

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: mediaProxyHeaders(mediaId, contentType || mediaInfo.mimeType),
    })
  } catch (error) {
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json(
      { error: t('media.fetchFailed') },
      { status: 500 }
    )
  }
}
