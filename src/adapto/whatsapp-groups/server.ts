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

/** Quanto tempo um nome de grupo fica em cache. */
const GROUP_NAME_TTL_MS = 10 * 60 * 1000;

/** Teto de tempo da consulta; um nome não vale travar o webhook. */
const TIMEOUT_MS = 5_000;

const cache = new Map<string, { name: string; expiresAt: number }>();

/** Só para testes e para invalidar quando o grupo é renomeado. */
export function clearGroupNameCache(): void {
  cache.clear();
}

interface WahaGroupInfo {
  JID?: string;
  Name?: string | null;
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
