// ============================================================
// Nomes e fotos do CRM na lista de menções.
//
// ## O problema
//
// A lista de menções mostrava número em vez de nome, e nunca foto. Os
// nomes existem — estão na tabela `contacts`, salvos pelo atendente ou
// importados pela sincronização — mas a lista vinha direto do WAHA, que
// não os tem: o payload de grupos devolve `DisplayName: ""` para todos
// (verificado; o WAHA preenche com telefone mascarado quando não sabe).
//
// ## A ponte
//
// `contacts` guarda telefone e a foto já sincronizada. O participante de
// grupo chega com `PhoneNumber` (`…@s.whatsapp.net`) ou JID `@c.us`; o
// telefone em dígitos casa com `contacts.phone`. É um join em memória:
// a lista inteira do CRM cabe numa consulta, indexada por telefone.
//
// ## Prioridade
//
//   1. nome do CRM (é o que o atendente cadastrou e reconhece)
//   2. agenda do WhatsApp (pushname; já vinha antes)
//   3. DisplayName do payload, quando é nome de verdade
//
// A foto só vem do CRM: a do WhatsApp é URL assinada que expira, e buscar
// por membro era o que tornou esse recurso caro da primeira vez (150
// requisições; ver o comentário em `fetchGroupMembers`).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Um contato do CRM, reduzido ao que a lista de menções usa. */
export interface CrmContactEntry {
  name: string;
  avatarUrl: string | null;
}

/**
 * Agenda do CRM indexada por telefone, em dígitos.
 *
 * Consulta UMA vez e devolve o mapa; quem chama faz o join em memória.
 * Retorna mapa vazio em qualquer falha — nome e foto são enfeite, a menção
 * em si é `@telefone` e não pode quebrar por causa deles.
 */
export async function loadCrmContactDirectory(
  db: SupabaseClient,
  accountId: string,
): Promise<Map<string, CrmContactEntry>> {
  const map = new Map<string, CrmContactEntry>();

  try {
    const { data, error } = await db
      .from('contacts')
      .select('phone, name, avatar_url')
      .eq('account_id', accountId)
      // Contatos de grupo (`phone = group:…`) não são pessoas; os que não
      // têm telefone não casam com participante nenhum de qualquer forma.
      .not('phone', 'like', 'group:%')
      .not('phone', 'is', null);

    if (error) return map;

    for (const row of data ?? []) {
      const rawPhone = (row.phone ?? '').trim();
      // Contato de grupo (`phone = group:…@g.us`) não é pessoa: a defesa
      // primária é o filtro `.not('phone', 'like', 'group:%')` no banco,
      // e esta checagem cobre o caso de o filtro mudar ou um fake de teste
      // não o simular.
      if (rawPhone.startsWith('group:')) continue;

      const phone = rawPhone.replace(/\D/g, '');
      if (!phone) continue;
      const name = (row.name ?? '').trim();
      const avatarUrl = (row.avatar_url ?? '').trim();

      // Sem nome E sem foto, a entrada não agrega nada — o número já está
      // na lista vindo do WAHA.
      if (!name && !avatarUrl) continue;

      map.set(phone, {
        name,
        // Só passa URL que exista; `?v=` do cache-busting é preservado.
        avatarUrl: avatarUrl || null,
      });
    }
  } catch {
    // A lista continua funcionando sem o enriquecimento.
  }

  return map;
}

/** Campos de contato que o CRM pode preencher num membro de grupo. */
export interface CrmContactFields {
  name?: string;
  avatarUrl?: string;
}

/**
 * Sobrescreve nome e foto do membro com o que o CRM tem.
 *
 * Mutação in-place por design: `toGroupMembers` acabou de criar os objetos
 * e eles não são compartilhados. Devolve o membro para facilitar encadear.
 *
 * O nome do CRM vence SEMPRE que existir — inclusive sobre um `DisplayName`
 * do WAHA. É deliberado: "Secretaria Silvana - Dr. Edson" diz mais ao
 * atendente que o pushname que o contato escolheu para si.
 */
export function applyCrmContact(
  member: { phone: string; name: string; avatarUrl: string | null },
  crm: Map<string, CrmContactEntry> | undefined,
): typeof member {
  if (!crm || !member.phone) return member;

  const entry = crm.get(member.phone);
  if (!entry) return member;

  if (entry.name) member.name = entry.name;
  if (entry.avatarUrl) member.avatarUrl = entry.avatarUrl;

  return member;
}
