// ============================================================
// Nome do grupo, buscado no WAHA.
//
// O evento de mensagem de grupo NÃO carrega o nome: o payload
// `message`/`message.any` traz `from` (o JID do grupo), `participant` (o
// membro que escreveu) e o corpo, mas nenhum `subject`. Verificado contra
// a sessão real desta instalação:
//
//   _data: Info, Message, IsEphemeral, …, RawMessage, IsReal, Status
//   groupMetadata: ausente
//
// Então o nome vem de `GET /api/{session}/groups/{id}`, que devolve
// `{ JID, Name, … }`. Uma chamada por mensagem seria desperdício num
// grupo movimentado, daí o cache com TTL: o nome de um grupo muda raras
// vezes, e quando muda ninguém perde mensagem por ver o nome antigo por
// alguns minutos.
//
// Segredo: nada além da URL base e da chave já usados pelo resto do app
// toca este módulo, e ele nunca é importado por componente `'use client'`.
// ============================================================

import { wahaBaseUrl, wahaSession } from '@/lib/whatsapp/waha';
import { memberPhone, toGroupMembers, type GroupMember } from './members';
import {
  applyCrmContact,
  loadCrmContactDirectory,
} from './crm-directory';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Quanto tempo um nome de grupo fica em cache. */
const GROUP_NAME_TTL_MS = 10 * 60 * 1000;

/** Teto de tempo da consulta; um nome não vale travar o webhook. */
const TIMEOUT_MS = 5_000;

const cache = new Map<string, { name: string; expiresAt: number }>();

/** Só para testes e para invalidar quando o grupo é renomeado. */
export function clearGroupNameCache(): void {
  cache.clear();
}

/**
 * Membros do grupo, com nome e foto.
 *
 * POR QUE NÃO UMA CHAMADA POR MEMBRO
 *
 * A versão anterior consultava contato e foto por TELEFONE, dois pedidos
 * por membro. Medido no grupo real desta instalação: 150 participantes →
 * 300 chamadas HTTP numa única abertura do seletor. Era essa a lentidão
 * relatada ("demora no carregamento dos contatos").
 *
 * Duas descobertas mudaram a abordagem:
 *
 *   1. O endpoint `GET /api/contacts/all?session=…` devolve a agenda
 *      INTEIRA numa chamada — 1088 contatos, 966 com nome, em ~100 ms.
 *      Uma chamada substitui 150.
 *
 *   2. Quase nenhum participante tem `PhoneNumber`. Verificado: o grupo
 *      tem 150 `@lid` e ZERO `@c.us`. Consultar contato por telefone
 *      (`…@c.us`) não casava com nada, então o nome vinha vazio mesmo
 *      para quem estava na agenda. O índice correto é o `@lid`.
 *
 * O `DisplayName` do participante NÃO serve como nome: o WAHA o preenche
 * com o telefone mascarado (`+55∙∙∙∙∙∙∙∙11`), que não identifica ninguém.
 *
 * A foto continua vindo por membro, mas agora sem bloquear a lista: os
 * nomes chegam na primeira resposta e as fotos entram depois (ver o
 * comentário de `withPictures`).
 *
 * ## Enriquecimento pelo CRM
 *
 * Além da agenda do WhatsApp, a lista cruza com a tabela `contacts` do
 * próprio CRM (uma consulta, indexada por telefone). O nome que o
 * atendente cadastrou vence o pushname — "Secretaria Silvana - Dr. Edson"
 * diz mais que o nome que o contato escolheu para si. A foto vem SEMPRE
 * do CRM: a do WhatsApp expira em ~2 dias.
 *
 * Chamadores com `db` fazem o enriquecimento; o sem (não há) manteria o
 * comportamento antigo. `crm` em cache por conta evita reconsultar a
 * cada abertura do seletor.
 */
export async function fetchGroupMembers(
  groupId: string,
  options: { db?: SupabaseClient; accountId?: string } = {}
): Promise<GroupMember[]> {
  const cached = membersCache.get(groupId);
  if (cached && cached.expiresAt > Date.now()) return cached.members;

  const url = `${wahaBaseUrl()}/api/${encodeURIComponent(wahaSession())}/groups/${encodeURIComponent(groupId)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: headers(), signal: controller.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as WahaGroupInfo;

    const participants = data?.Participants ?? [];
    // O diretório é uma chamada só; se falhar, a lista ainda é montada com
    // os identificadores (o atendente menciona pelo telefone quando houver).
    const directory = await fetchContactDirectory().catch(
      () => new Map<string, string>()
    );

    const members = toGroupMembers(
      participants,
      directory
    );

    // Nomes e fotos do CRM (ver `crm-directory.ts`). Consulta única por
    // conta; falha degrada para o comportamento anterior, sem erro.
    if (options.db && options.accountId) {
      const crm = await loadCrmContactDirectory(options.db, options.accountId);
      if (crm.size > 0) {
        for (const member of members) {
          applyCrmContact(member, crm);
        }
        // Re-ordena: o nome do CRM muda a ordem alfabética calculada antes
        // do enriquecimento.
        members.sort((a, b) => {
          if (a.name && b.name) return a.name.localeCompare(b.name);
          if (a.name) return -1;
          if (b.name) return 1;
          return (a.phone || a.waId).localeCompare(b.phone || b.waId);
        });
      }
    }

    membersCache.set(groupId, {
      members,
      expiresAt: Date.now() + MEMBERS_TTL_MS,
    });
    return members;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Quanto tempo a lista de membros fica em cache. */
const MEMBERS_TTL_MS = 5 * 60 * 1000;

const membersCache = new Map<string, { members: GroupMember[]; expiresAt: number }>();

/** Só para testes. */
export function clearMembersCache(): void {
  membersCache.clear();
}

/**
 * Agenda de contatos indexada por identificador (`lid` e telefone).
 *
 * `GET /api/contacts/all` devolve uma entrada por contato com `id`
 * (`…@lid` ou `…@c.us`) e o `pushname` que o WhatsApp conhece. Uma
 * chamada para o diretório inteiro é ordens de magnitude mais barata que
 * uma por membro, e responde pelo identificador que o participante
 * realmente usa.
 *
 * Devolve mapa vazio em falha: nome é enfeite, a menção não é.
 */
async function fetchContactDirectory(): Promise<Map<string, string>> {
  const url = `${wahaBaseUrl()}/api/contacts/all?session=${encodeURIComponent(wahaSession())}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS * 3);
  try {
    const res = await fetch(url, { headers: headers(), signal: controller.signal });
    if (!res.ok) return new Map();

    const rows = (await res.json()) as Array<{
      id?: string;
      name?: string;
      pushname?: string;
    }>;

    const byId = new Map<string, string>();
    for (const row of rows ?? []) {
      const id = (row.id ?? '').trim();
      if (!id) continue;
      const name = (row.name ?? row.pushname ?? '').trim();
      if (name) byId.set(id, name);
    }
    return byId;
  } catch {
    return new Map();
  } finally {
    clearTimeout(timer);
  }
}

interface WahaGroupInfo {
  JID?: string;
  Name?: string | null;
  Participants?: Array<{
    JID?: string;
    PhoneNumber?: string;
    LID?: string;
    IsAdmin?: boolean;
    IsSuperAdmin?: boolean;
    DisplayName?: string;
  }>;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {};
  const key = process.env.WAHA_API_KEY?.trim();
  if (key) h['X-Api-Key'] = key;
  return h;
}

/**
 * Nome do grupo, ou `null` quando o WAHA não sabe responder.
 *
 * `null` é um resultado legítimo: grupo recém-criado, sessão fora do ar,
 * WAHA indisponível. O chamador decide o rótulo (ver `groupDisplayName`),
 * e a mensagem nunca é descartada só porque o nome falhou.
 */
export async function fetchGroupName(
  groupId: string,
  now: () => number = Date.now
): Promise<string | null> {
  const cached = cache.get(groupId);
  if (cached && cached.expiresAt > now()) return cached.name;

  const url = `${wahaBaseUrl()}/api/${encodeURIComponent(wahaSession())}/groups/${encodeURIComponent(groupId)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: headers(), signal: controller.signal });
    if (!res.ok) return null;

    const data = (await res.json()) as WahaGroupInfo;
    const name = typeof data?.Name === 'string' ? data.Name.trim() : '';
    if (!name) return null;

    cache.set(groupId, { name, expiresAt: now() + GROUP_NAME_TTL_MS });
    return name;
  } catch {
    // Rede, timeout, JSON inválido: o nome é cosmético, a mensagem não é.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
