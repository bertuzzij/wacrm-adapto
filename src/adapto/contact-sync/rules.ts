/**
 * Regras puras da sincronização de contatos.
 *
 * Separadas do `sync.ts` (que faz rede e banco) para poderem ser testadas
 * sem WAHA nem Supabase. São justamente as decisões onde um erro é caro:
 * qual identificador usar, e quando é permitido sobrescrever um nome.
 */

export interface ContactIdentity {
  phone?: string | null;
  wa_user_id?: string | null;
  wa_username?: string | null;
}

/**
 * Chat id que o WAHA aceita para consultar perfil/foto.
 *
 * Ordem de preferência:
 *   1. `wa_user_id` — no WhatsApp novo é um `@lid`. É o identificador que
 *      os endpoints de chat resolvem de forma confiável.
 *   2. telefone — formato legado `@c.us`.
 *
 * Grupos: o contato do grupo mora em `phone` como `group:<jid>` (o JID
 * completo, ex. `5511…-99…@g.us`). O endpoint de foto do WAHA
 * (`/chats/{chatId}/picture`, verificado com 200 em grupo real) aceita o
 * JID do grupo direto — é o que faz a capa do grupo ser sincronizável
 * como a foto de qualquer contato.
 *
 * Devolve `null` quando não há nenhum dos dois: um contato sem telefone e
 * sem lid (possível com BSUID da Meta) não tem como ser consultado.
 */
export function chatIdFor(contact: ContactIdentity): string | null {
  const rawPhone = contact.phone?.trim();

  // Grupo: `group:<jid>` → o JID é o chat id. Antes deste caso, o
  // contact-sync ignorava grupos (só dígitos casavam) e a capa nunca
  // chegava ao CRM.
  if (rawPhone?.startsWith('group:')) {
    const jid = rawPhone.slice('group:'.length).trim();
    return jid.includes('@') ? jid : null;
  }

  const lid = contact.wa_user_id?.trim();
  if (lid) return lid.includes('@') ? lid : `${lid}@lid`;

  const digits = rawPhone?.replace(/\D/g, '');
  if (digits) return `${digits}@c.us`;

  return null;
}

/**
 * Pode sobrescrever o nome existente?
 *
 * Regra: só quando o nome veio do WhatsApp ou nunca foi sincronizado.
 * `name_source = 'manual'` significa que uma pessoa digitou — e apagar
 * isso seria destruir o único dado que o CRM tem a mais que o WhatsApp.
 */
export function canOverwriteName(nameSource: string | null | undefined): boolean {
  return nameSource !== 'manual';
}

/**
 * Decide o que fazer com o nome de um contato.
 *
 * Devolve o novo nome a gravar, ou `null` para deixar como está. Separado
 * para o teste cobrir a matriz inteira sem tocar em banco.
 */
export function resolveName(input: {
  currentName: string | null;
  currentSource: string | null;
  whatsappName: string | null;
}): { name: string; source: 'whatsapp' } | null {
  const { currentName, currentSource, whatsappName } = input;

  if (!whatsappName) return null;
  const next = whatsappName.trim();
  if (!next) return null;
  if (!canOverwriteName(currentSource)) return null;
  if (next === currentName) return null;

  return { name: next, source: 'whatsapp' };
}

/** Extensão de arquivo a partir do Content-Type devolvido pelo CDN. */
export function extFor(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  return 'jpg';
}
