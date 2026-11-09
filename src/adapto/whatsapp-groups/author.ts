// ============================================================
// Quem escreveu uma mensagem de grupo.
//
// O WhatsApp mostra o nome do membro acima de cada bolha em conversa de
// grupo, porque ali há várias pessoas. O CRM fazia diferente: todo membro
// externo virava `sender_type = 'customer'`, sem nome — então uma thread
// com seis participantes parecia um monólogo de "o cliente".
//
// O dado sempre existiu no payload do WAHA; ele era descartado ao traduzir
// para o formato Meta (que não tem campo para autor de grupo, porque a
// Cloud API oficial não expõe grupos). Este módulo recupera o dado antes
// dessa tradução.
//
// Campos reais, de um payload de produção:
//
//   participant          = "25229342556178@lid"          (LID do autor)
//   _data.Info.PushName  = "Marketing Amplimed"          (nome exibição)
//   _data.Info.SenderAlt = "554991559280@s.whatsapp.net" (telefone)
//
// Módulo puro de propósito: as regras de escolha e normalização são
// testáveis sem rede nem banco.
// ============================================================

/** Autor de uma mensagem, como será persistido em `messages`. */
export interface MessageAuthor {
  /** Nome de exibição. Pode faltar se o remetente nunca publicou um. */
  name: string | null;
  /** Identificador WhatsApp estável (LID ou JID). */
  waId: string | null;
  /** Só dígitos, quando o WAHA informou o telefone real. */
  phone: string | null;
}

/** O subconjunto do payload do WAHA que interessa para identificar o autor. */
export interface AuthorSourcePayload {
  from?: string;
  participant?: string | null;
  _data?: {
    Info?: {
      Sender?: string;
      SenderAlt?: string;
      PushName?: string;
      IsGroup?: boolean;
    };
    notifyName?: string;
    pushName?: string;
    [key: string]: unknown;
  };
}

/**
 * Telefone a partir de um JID (`554991559280@s.whatsapp.net`).
 *
 * Devolve null para LID (`…@lid`): o número ali é opaco e trocá-lo por
 * dígitos produziria um telefone falso — exatamente o bug que
 * `identity.ts` documenta para ids de grupo.
 */
export function phoneFromJid(jid: string | null | undefined): string | null {
  const raw = (jid ?? '').trim();
  if (!raw) return null;
  if (raw.endsWith('@lid')) return null;
  if (raw.endsWith('@g.us')) return null;
  if (raw.endsWith('@newsletter')) return null;
  if (raw.startsWith('status@')) return null;

  // `@c.us` (WAHA) e `@s.whatsapp.net` (Baileys) são os formatos de telefone.
  const digits = raw.split('@')[0].replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/**
 * Nome de exibição do autor.
 *
 * Ordem: `PushName` do `Info` (é o que o WhatsApp mostra na bolha) e, na
 * falta, `notifyName`/`pushName` do topo do payload — variação de build do
 * WAHA. Devolve null em vez de string vazia para o chamador não precisar
 * testar as duas coisas.
 */
export function authorNameFrom(payload: AuthorSourcePayload): string | null {
  const info = payload._data?.Info;
  const candidates = [
    info?.PushName,
    payload._data?.notifyName,
    payload._data?.pushName,
  ];
  for (const candidate of candidates) {
    const value = (candidate ?? '').trim();
    if (value) return value;
  }
  return null;
}

/**
 * Identificador estável do autor.
 *
 * `payload.participant` é o campo canônico em grupo (o WAHA o preenche no
 * topo, fora do `_data`). `Info.Sender` é o fallback. Em ambos os casos o
 * valor costuma ser um LID, que é estável por número mesmo sem telefone.
 */
export function authorWaIdFrom(payload: AuthorSourcePayload): string | null {
  const candidates = [payload.participant, payload._data?.Info?.Sender];
  for (const candidate of candidates) {
    const value = (candidate ?? '').trim();
    if (value) return value;
  }
  return null;
}

/**
 * Autor completo, ou null quando não há nada útil.
 *
 * Chamado só para mensagem RECEBIDA em conversa de grupo. Devolver null é
 * o resultado normal para conversa individual, e mantém as colunas novas
 * limpas onde elas não significam nada.
 */
export function messageAuthorFrom(
  payload: AuthorSourcePayload,
  opts: { isGroup: boolean }
): MessageAuthor | null {
  if (!opts.isGroup) return null;
  // Mensagem nossa não tem "autor externo": quem enviou foi a equipe, e o
  // `sender_id` já responde isso com precisão.
  const waId = authorWaIdFrom(payload);
  const name = authorNameFrom(payload);
  const phone = phoneFromJid(payload._data?.Info?.SenderAlt);

  if (!name && !waId && !phone) return null;
  return { name, waId, phone };
}
