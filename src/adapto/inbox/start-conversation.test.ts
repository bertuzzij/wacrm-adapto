import { describe, expect, it, vi } from 'vitest';

import {
  conversationKindForContactPhone,
  inboxConversationHref,
  requestStartConversation,
} from './start-conversation';

describe('inboxConversationHref', () => {
  it('monta o deep-link da inbox com o id da conversa', () => {
    expect(inboxConversationHref('conv-123')).toBe('/inbox?c=conv-123');
  });

  it('escapa caracteres especiais no id', () => {
    expect(inboxConversationHref('a&b=c')).toBe('/inbox?c=a%26b%3Dc');
  });
});

describe('conversationKindForContactPhone', () => {
  it('retorna direct para telefones comuns ou ausentes', () => {
    expect(conversationKindForContactPhone('+5516999999999')).toBe('direct');
    expect(conversationKindForContactPhone('5516999999999')).toBe('direct');
    expect(conversationKindForContactPhone(null)).toBe('direct');
    expect(conversationKindForContactPhone(undefined)).toBe('direct');
  });

  it('retorna group quando o contato representa um grupo do WhatsApp', () => {
    expect(conversationKindForContactPhone('group:120363000000000000@g.us')).toBe('group');
  });
});

describe('requestStartConversation', () => {
  it('envia contact_id e devolve conversationId e created', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ conversationId: 'conv-42', created: true }),
    });

    const result = await requestStartConversation('contact-7', mockFetch as unknown as typeof fetch);

    expect(mockFetch).toHaveBeenCalledWith('/api/adapto/conversations/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: 'contact-7' }),
    });
    expect(result).toEqual({ conversationId: 'conv-42', created: true });
  });

  it('propaga a mensagem de erro devolvida pela API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Contact not found' }),
    });

    await expect(
      requestStartConversation('missing', mockFetch as unknown as typeof fetch),
    ).rejects.toThrow('Contact not found');
  });

  it('usa status HTTP quando o corpo de erro não traz mensagem', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    });

    await expect(
      requestStartConversation('contact-7', mockFetch as unknown as typeof fetch),
    ).rejects.toThrow('HTTP 500');
  });

  it('falha quando a resposta 200 não traz conversationId', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await expect(
      requestStartConversation('contact-7', mockFetch as unknown as typeof fetch),
    ).rejects.toThrow('Missing conversationId');
  });
});
