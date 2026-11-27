// ============================================================
// Iniciar (ou abrir) uma conversa a partir de um contato.
//
// Na API oficial da Meta o único ponto de entrada sem mensagem prévia
// do cliente era "Enviar modelo". No modo WAHA não há janela de 24h nem
// obrigatoriedade de template — o atendente só precisa abrir o chat do
// contato na caixa de entrada e digitar.
//
// Este módulo concentra as regras puras e a chamada HTTP para a rota
// `/api/adapto/conversations/start`, deixando a UI de Contatos enxuta e
// testável sem rede.
// ============================================================

import { isGroupPhoneKey } from '@/adapto/whatsapp-groups/identity';

export interface StartConversationResult {
  conversationId: string;
  created: boolean;
}

/** Deep-link da inbox que já abre a conversa selecionada. */
export function inboxConversationHref(conversationId: string): string {
  return `/inbox?c=${encodeURIComponent(conversationId)}`;
}

/** Tipo de conversa compatível com a chave de telefone armazenada no contato. */
export function conversationKindForContactPhone(
  phone: string | null | undefined,
): 'direct' | 'group' {
  return isGroupPhoneKey(phone) ? 'group' : 'direct';
}

/**
 * Garante que existe uma conversa aberta para `contactId` na conta atual
 * e devolve o id para navegação na inbox.
 */
export async function requestStartConversation(
  contactId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StartConversationResult> {
  const res = await fetchImpl('/api/adapto/conversations/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contact_id: contactId }),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    conversationId?: unknown;
    created?: unknown;
    error?: unknown;
  };

  if (!res.ok) {
    const reason =
      typeof payload.error === 'string' && payload.error.trim().length > 0
        ? payload.error
        : `HTTP ${res.status}`;
    throw new Error(reason);
  }

  if (typeof payload.conversationId !== 'string' || !payload.conversationId) {
    throw new Error('Missing conversationId');
  }

  return {
    conversationId: payload.conversationId,
    created: payload.created === true,
  };
}
