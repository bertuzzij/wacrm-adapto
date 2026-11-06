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
  /** Telefone em dígitos, sem sufixo `@c.us`. */
  phone: string;
  /** Nome conhecido, ou '' quando o WAHA não sabe. */
  name: string;
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

/** Converte a resposta do endpoint de grupos em membros utilizáveis. */
export function toGroupMembers(
  participants: WahaParticipant[] | null | undefined
): GroupMember[] {
  const out: GroupMember[] = [];
  const seen = new Set<string>();

  for (const p of participants ?? []) {
    const phone = memberPhone(p);
    // Sem telefone não há menção possível: o `@lid` não é endereçável pelo
    // texto. Pular aqui evita oferecer na tela alguém que não menciona.
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);

    out.push({
      phone,
      name: (p.DisplayName ?? '').trim(),
      isAdmin: p.IsAdmin === true || p.IsSuperAdmin === true,
    });
  }

  // Ordena por nome quando existe, para a lista ficar previsível; quem não
  // tem nome vai para o fim, por telefone.
  return out.sort((a, b) => {
    if (a.name && b.name) return a.name.localeCompare(b.name);
    if (a.name) return -1;
    if (b.name) return 1;
    return a.phone.localeCompare(b.phone);
  });
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
    // Fronteira à esquerda para `@5516…` não casar dentro de `x@5516…`;
    // `\D` à direita para não pegar um telefone que só é prefixo de outro.
    const pattern = new RegExp(`@${m.phone}(?!\\d)`);
    if (pattern.test(text)) found.push(m.phone);
  }
  return found;
}
