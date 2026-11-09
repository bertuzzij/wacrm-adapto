// ============================================================
// Membros de um grupo e menções (@).
//
// O WhatsApp menciona por TELEFONE, não por nome: o texto leva
// `@5516992890664` e o payload leva a lista de JIDs em `mentions`. O cliente
// renderiza como um chip com o nome que ele mesmo tem salvo — então o nome
// que aparece do outro lado não é o nosso, é o da agenda de quem recebe.
//
// Por isso este módulo separa duas coisas:
//
//   - a LISTA (telefone + nome) é para o atendente escolher na tela;
//   - a MENÇÃO é `@telefone`, que é o que o WhatsApp entende.
//
// Guardar o nome junto serve só para a tela; nada dele vai no texto.
// ============================================================

/** Um participante do grupo, como a tela mostra. */
export interface GroupMember {
  /** Telefone em dígitos, sem sufixo `@c.us`. Vazio quando só há LID. */
  phone: string;
  /**
   * Identificador WhatsApp do participante (`…@lid` ou `…@c.us`).
   *
   * É por ele que a agenda é consultada: no grupo medido, todos os 150
   * participantes eram `@lid` e nenhum tinha telefone.
   */
  waId: string;
  /** Nome conhecido, ou '' quando o WAHA não sabe. */
  name: string;
  /** URL da foto de perfil, ou null. Já copiada para o nosso Storage. */
  avatarUrl: string | null;
  /** Administrador do grupo. */
  isAdmin: boolean;
}

/** O que o WAHA devolve por participante. */
interface WahaParticipant {
  JID?: string;
  PhoneNumber?: string;
  LID?: string;
  IsAdmin?: boolean;
  IsSuperAdmin?: boolean;
  /**
   * Nome do participante — quase sempre VAZIO.
   *
   * Verificado contra a API real: o endpoint de grupos devolve
   * `DisplayName: ""` para todos os membros. O nome de verdade está no
   * endpoint de contatos, consultado por telefone. Este campo fica como
   * atalho para quando o WAHA passar a preenchê-lo.
   */
  DisplayName?: string;
}

/**
 * Telefone de um participante, em dígitos.
 *
 * Prefere `PhoneNumber` (`5516…@s.whatsapp.net`), que é o endereço que o
 * envio usa. Cai para o `JID` quando ele já é um telefone; um JID `@lid`
 * (identificador opaco do WhatsApp novo) NÃO serve como telefone e devolve
 * string vazia — melhor não oferecer o membro do que mencionar um número
 * que não existe.
 */
export function memberPhone(participant: WahaParticipant): string {
  const fromPhone = (participant.PhoneNumber ?? '').split('@')[0];
  if (/^\d{8,15}$/.test(fromPhone)) return fromPhone;

  const jid = participant.JID ?? '';
  if (jid.endsWith('@c.us') || jid.endsWith('@s.whatsapp.net')) {
    const digits = jid.split('@')[0].replace(/\D/g, '');
    if (/^\d{8,15}$/.test(digits)) return digits;
  }
  return '';
}

/**
 * `DisplayName` do participante, quando ele é um NOME de verdade.
 *
 * O WAHA preenche este campo com o telefone mascarado (`+55∙∙∙∙∙∙∙∙11`)
 * quando não conhece a pessoa — usar isso como nome enche a lista de
 * rótulos inúteis. Um valor só passa se tiver alguma letra e não for
 * apenas um número mascarado.
 */
function usableDisplayName(value: string | null | undefined): string {
  const name = (value ?? '').trim();
  if (!name) return '';
  // Mascarado: dígitos, `+`, espaços e o caractere de bolinha.
  if (/^[+\d\s∙•·]+$/.test(name)) return '';
  return /[a-zA-Z\u00C0-\u024F]/.test(name) ? name : '';
}

/**
 * Converte a resposta do endpoint de grupos em membros utilizáveis.
 *
 * Duas correções em relação à primeira versão, ambas verificadas contra a
 * API real desta instalação:
 *
 *   1. O nome é resolvido pelo IDENTIFICADOR (`@lid`), não pelo telefone.
 *      O grupo medido tem 150 participantes, todos `@lid` e nenhum `@c.us`
 *      — consultar contato por telefone não casava com nada, e o nome
 *      vinha vazio mesmo para quem estava na agenda.
 *
 *   2. `DisplayName` só é usado quando é um nome real. Quando o WAHA não
 *      conhece a pessoa, ele traz o telefone mascarado ali.
 *
 * Quem não tem telefone continua aparecendo: a menção acontece pelo texto
 * quando há telefone, mas o membro sem telefone ainda é informação útil
 * ("o fulano está no grupo") e antes ele era descartado em silêncio.
 */
export function toGroupMembers(
  participants: WahaParticipant[] | null | undefined,
  /**
   * Agenda indexada por identificador (`lid`/telefone) → nome.
   *
   * Vem de fora porque exige rede. Uma única consulta ao diretório da
   * sessão substitui uma chamada por membro (ver `fetchGroupMembers`).
   */
  directory?: Map<string, string>
): GroupMember[] {
  const out: GroupMember[] = [];
  const seen = new Set<string>();

  for (const p of participants ?? []) {
    const phone = memberPhone(p);
    const waId = memberWaId(p);
    // Sem identificador nenhum não há como deduplicar nem mencionar.
    if (!phone && !waId) continue;
    const key = phone || waId;
    if (seen.has(key)) continue;
    seen.add(key);

    // Prioridade: diretório (nome da agenda) > DisplayName (quando é nome
    // de verdade) > vazio.
    const name =
      directory?.get(waId) ?? directory?.get(phone) ?? usableDisplayName(p.DisplayName);

    out.push({
      phone,
      waId,
      name: name.trim(),
      // Foto por membro sairia caro (150 requisições); fica nula e a lista
      // mostra as iniciais. O avatar de contato continua sendo importado
      // separadamente pelo fluxo de sincronização.
      avatarUrl: null,
      isAdmin: p.IsAdmin === true || p.IsSuperAdmin === true,
    });
  }

  // Ordena por nome quando existe, para a lista ficar previsível; quem não
  // tem nome vai para o fim, por identificador.
  return out.sort((a, b) => {
    if (a.name && b.name) return a.name.localeCompare(b.name);
    if (a.name) return -1;
    if (b.name) return 1;
    return (a.phone || a.waId).localeCompare(b.phone || b.waId);
  });
}

/**
 * Identificador do participante para busca na agenda.
 *
 * É o `@lid` na grande maioria dos grupos atuais — é o índice em que a
 * agenda do WAHA realmente guarda o nome.
 */
export function memberWaId(participant: WahaParticipant): string {
  const jid = (participant.JID ?? '').trim();
  if (jid) return jid;
  const lid = (participant.LID ?? '').trim();
  if (lid) return lid;
  const phone = memberPhone(participant);
  return phone ? `${phone}@c.us` : '';
}

/** Marcador da menção, exatamente como o WhatsApp espera no texto. */
export function mentionToken(phone: string): string {
  return `@${phone}`;
}

/** JID como o WAHA espera na lista `mentions`. */
export function mentionJid(phone: string): string {
  return `${phone.replace(/\D/g, '')}@c.us`;
}

/**
 * Descobre quais telefones da lista foram mencionados no texto.
 *
 * Serve para o CRM gravar a menção de verdade em vez de confiar no que a
 * tela montou: o atendente pode apagar o `@` ao editar, e mandar `mentions`
 * de alguém que não está mais no texto produziria um chip fantasma.
 */
export function mentionedPhones(
  text: string,
  members: readonly GroupMember[]
): string[] {
  const found: string[] = [];
  for (const m of members) {
    // Membro sem telefone não é mencionável por texto: o WhatsApp menciona
    // por número, e um LID não serve.
    if (!m.phone) continue;
    // Fronteira à esquerda para `@5516…` não casar dentro de `x@5516…`;
    // `\D` à direita para não pegar um telefone que só é prefixo de outro.
    const pattern = new RegExp(`@${m.phone}(?!\\d)`);
    if (pattern.test(text)) found.push(m.phone);
  }
  return found;
}
