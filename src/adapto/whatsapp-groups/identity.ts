// ============================================================
// Identidade de conversa de grupo do WhatsApp.
//
// Grupos chegam pelo WAHA com um id no formato
// `5511000000001-1000000001@g.us`, e eram descartados de propósito em
// `isIgnoredChat` — o CRM nasceu modelado só para conversa individual.
//
// O problema de encaixar grupo no schema atual:
//
//   - `chatIdToPhone()` extrai só dígitos, então um `@g.us` viraria
//     `55110000000011000000001`: um telefone falso, que colidiria com
//     qualquer coisa e não teria volta.
//   - `contacts.phone` é NOT NULL e único por conta (migração 022), e
//     grupo não tem telefone.
//
// A saída usa o mecanismo que o upstream já criou para contatos sem
// telefone (BSUID, migração 040): a coluna `wa_user_id` aceita nulo num
// índice único parcial. Aqui o id do grupo vai para o lugar do telefone
// com um prefixo `group:`, que é estável, único por grupo, e nunca
// colide com telefone de pessoa porque não é numérico.
//
// Módulo puro de propósito: dá para testar o reconhecimento e a chave
// sem rede nem banco.
// ============================================================

/** Sufixo dos ids de conversa em grupo no WhatsApp. */
const GROUP_SUFFIX = '@g.us';

/** Prefixo gravado em `contacts.phone` para uma conversa de grupo. */
const GROUP_PHONE_PREFIX = 'group:';

/** True para um id de conversa em grupo (`…@g.us`). */
export function isGroupChatId(chatId: string | null | undefined): boolean {
  return typeof chatId === 'string' && chatId.trim().endsWith(GROUP_SUFFIX);
}

/**
 * Chave estável gravada em `contacts.phone` para um grupo.
 *
 * Idempotente: passar o valor já prefixado devolve o mesmo valor, para
 * que uma segunda chamada não produza `group:group:…`.
 */
export function groupPhoneKey(chatId: string): string {
  const raw = chatId.trim();
  if (raw.startsWith(GROUP_PHONE_PREFIX)) return raw;
  return `${GROUP_PHONE_PREFIX}${raw}`;
}

/** True quando a string é uma chave de grupo já normalizada. */
export function isGroupPhoneKey(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().startsWith(GROUP_PHONE_PREFIX);
}

/**
 * O id de chat de um grupo, a partir do que estiver em `contacts.phone`.
 *
 * Usado para responder (fase futura) e para exibir o JID em telas de
 * diagnóstico. Devolve `null` quando o valor não é de grupo.
 */
export function groupChatIdFromPhoneKey(value: string | null | undefined): string | null {
  if (!isGroupPhoneKey(value)) return null;
  const raw = (value as string).trim().slice(GROUP_PHONE_PREFIX.length);
  return raw.length > 0 ? raw : null;
}

/**
 * Nome a exibir para um grupo.
 *
 * O WAHA já manda o nome que o operador vê no WhatsApp; quando falta
 * (grupo recém-criado, ou evento sem `_data.subject`), cai num rótulo
 * neutro em vez de mostrar o JID cru para o atendente.
 */
export function groupDisplayName(
  name: string | null | undefined,
  fallback = '(grupo sem nome)'
): string {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Tipo da conversa a partir do chat id de origem.
 *
 * Existe para o webhook decidir entre os dois caminhos sem espalhar
 * `endsWith('@g.us')` por todo lado.
 */
export function conversationKindFor(chatId: string | null | undefined): 'direct' | 'group' {
  return isGroupChatId(chatId) ? 'group' : 'direct';
}
