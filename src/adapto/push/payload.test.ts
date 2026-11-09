import { describe, expect, it } from 'vitest'
import { buildPushPayload, shouldPushMessage } from './payload'

const CONTACT = { name: 'Maria Silva', wa_username: null, phone: '5511999999999' }

function msg(over: Partial<Parameters<typeof buildPushPayload>[0]['message']> = {}) {
  return {
    conversation_id: 'conv-1',
    sender_type: 'customer' as const,
    content_type: 'text' as const,
    content_text: 'Oi, tudo bem?',
    ...over,
  }
}

describe('shouldPushMessage', () => {
  it('empurra mensagem de cliente', () => {
    expect(shouldPushMessage({ sender_type: 'customer' })).toBe(true)
  })

  it('NÃO empurra mensagem do próprio atendente', () => {
    // Responder pelo celular faria o próprio celular apitar.
    expect(shouldPushMessage({ sender_type: 'agent' })).toBe(false)
  })
})

describe('buildPushPayload', () => {
  it('usa o nome do contato como título e o texto como corpo', () => {
    const p = buildPushPayload({ message: msg(), contact: CONTACT })
    expect(p).toEqual({
      title: 'Maria Silva',
      body: 'Oi, tudo bem?',
      tag: 'conv-1',
      url: '/inbox?c=conv-1',
    })
  })

  it('agrupa por conversa (tag), para não empilhar avisos do mesmo cliente', () => {
    const a = buildPushPayload({ message: msg(), contact: CONTACT })
    const b = buildPushPayload({
      message: msg({ content_text: 'segunda mensagem' }),
      contact: CONTACT,
    })
    expect(a?.tag).toBe('conv-1')
    expect(b?.tag).toBe('conv-1')
  })

  it('cai no telefone quando o contato não tem nome salvo', () => {
    const p = buildPushPayload({
      message: msg(),
      contact: { name: null, wa_username: null, phone: '5511999999999' },
    })
    expect(p?.title).toBe('5511999999999')
  })

  it('identifica o app quando nem nome nem telefone existem', () => {
    // No celular, um aviso só com "New message" não diz de qual app veio.
    // (Sem tradutor o padrão é inglês — o serviço passa as strings
    // traduzidas em produção; ver o teste de rótulos abaixo.)
    const p = buildPushPayload({
      message: msg(),
      contact: null,
      appName: 'AdaptoConect',
    })
    expect(p?.title).toBe('New message · AdaptoConect')
  })

  it('identifica o app com o rótulo traduzido quando há tradutor', () => {
    const p = buildPushPayload({
      message: msg(),
      contact: null,
      appName: 'AdaptoConect',
      labels: {
        fallbackTitle: 'Nova mensagem',
        image: '📷 Foto',
        audio: '🎤 Mensagem de voz',
        video: '🎬 Vídeo',
        document: '📄 Documento',
        location: '📍 Localização',
        template: '📋 Modelo',
      },
    })
    expect(p?.title).toBe('Nova mensagem · AdaptoConect')
  })

  it('descreve mídia em vez de mandar corpo vazio', () => {
    const p = buildPushPayload({
      message: msg({ content_type: 'image', content_text: null }),
      contact: CONTACT,
    })
    expect(p?.body).toBe('📷 Photo')
  })

  it('usa os rótulos traduzidos quando fornecidos', () => {
    const p = buildPushPayload({
      message: msg({ content_type: 'audio', content_text: null }),
      contact: CONTACT,
      labels: {
        fallbackTitle: 'Nova mensagem',
        image: '📷 Foto',
        audio: '🎤 Mensagem de voz',
        video: '🎬 Vídeo',
        document: '📄 Documento',
        location: '📍 Localização',
        template: '📋 Modelo',
      },
    })
    expect(p?.body).toBe('🎤 Mensagem de voz')
  })

  it('junta legenda de mídia ao descritor', () => {
    const p = buildPushPayload({
      message: msg({ content_type: 'image', content_text: 'olha isso' }),
      contact: CONTACT,
    })
    expect(p?.body).toBe('📷 Photo · olha isso')
  })

  it('trunca texto muito longo', () => {
    const p = buildPushPayload({
      message: msg({ content_text: 'a'.repeat(400) }),
      contact: CONTACT,
    })
    // O corpo do aviso tem limite prático; texto enorme é ilegível na tela
    // de bloqueio e estoura o payload do serviço de push.
    expect(p!.body.length).toBeLessThanOrEqual(121)
    expect(p!.body.endsWith('…')).toBe(true)
  })

  it('devolve null para mensagem do atendente', () => {
    const p = buildPushPayload({
      message: msg({ sender_type: 'agent' }),
      contact: CONTACT,
    })
    expect(p).toBeNull()
  })

  it('monta URL de deep link para a conversa certa', () => {
    const p = buildPushPayload({
      message: msg({ conversation_id: 'abc-123' }),
      contact: CONTACT,
    })
    expect(p?.url).toBe('/inbox?c=abc-123')
  })

  it('escapa id de conversa na URL', () => {
    const p = buildPushPayload({
      message: msg({ conversation_id: 'a&b=c' }),
      contact: CONTACT,
    })
    expect(p?.url).toBe('/inbox?c=a%26b%3Dc')
  })
})
