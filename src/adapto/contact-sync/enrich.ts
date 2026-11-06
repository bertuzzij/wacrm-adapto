// ============================================================
// Nome e foto de um contato, buscados no WAHA sob demanda.
//
// A sincronização em lote (`contact-sync/sync.ts`) depende de listar os
// chats recentes, e essa janela é finita: um contato antigo nunca aparece
// nela. Verificado nesta instalação — quatro contatos apareciam com o
// telefone como nome enquanto o WAHA sabia o nome dos quatro; nenhum estava
// entre os 200 chats mais recentes.
//
// Este módulo resolve o caso que importa: a mensagem acabou de chegar, o
// contato está na nossa frente, e dá para perguntar por ele direto
// (`/api/contacts?contactId=`), sem depender de janela nenhuma.
//
// Roda em background, nunca bloqueia o webhook. Um nome que chega 300ms
// depois não vale atrasar a mensagem do cliente — e se o WAHA estiver fora,
// a mensagem entra com o telefone e o nome vem numa próxima tentativa.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { wahaBaseUrl, wahaGetChatPicture, wahaSession } from '@/lib/whatsapp/waha';
import { chatIdFor } from './rules';

/** Teto de tempo por consulta; nome é cosmético, mensagem não é. */
const TIMEOUT_MS = 5_000;

/** Bucket das fotos de contato (migration 061). */
const BUCKET = 'contact-avatars';

/** Teto por imagem; o bucket aceita 2 MB. */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

interface WahaContactInfo {
  id?: string;
  /** Nome salvo na agenda do dono do número — o que queremos. */
  name?: string | null;
  /** Nome que o próprio contato escolheu. Menos confiável, mas melhor que nada. */
  pushname?: string | null;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {};
  const key = process.env.WAHA_API_KEY?.trim();
  if (key) h['X-Api-Key'] = key;
  return h;
}

/**
 * Nome do contato no WhatsApp, ou null.
 *
 * Prefere `name` (agenda) sobre `pushname` (autoescolhido): é a mesma
 * ordem que a sincronização em lote usa, e é o nome que o operador
 * reconhece.
 */
export async function fetchContactName(chatId: string): Promise<string | null> {
  const url = `${wahaBaseUrl()}/api/contacts?session=${encodeURIComponent(wahaSession())}&contactId=${encodeURIComponent(chatId)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: headers(), signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as WahaContactInfo;
    const picked = (data?.name ?? data?.pushname ?? '').trim();
    return picked || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface EnrichInput {
  contactId: string;
  phone: string | null;
  name: string | null;
  nameSource: string | null;
  waUserId: string | null;
  /** Quando a foto foi tentada pela última vez; null = nunca. */
  avatarSyncedAt?: string | null;
}

/**
 * Completa nome e foto de UM contato.
 *
 * Só toca no nome quando ele está vazio ou é o próprio telefone: um nome
 * digitado à mão (`name_source = 'manual'`) é intocável — apagá-lo
 * destruiria o único dado que o CRM tem a mais que o WhatsApp.
 *
 * Nunca lança. Falha aqui não pode derrubar o processamento da mensagem
 * que a chamou.
 */
export async function enrichContact(
  db: SupabaseClient,
  input: EnrichInput
): Promise<void> {
  try {
    const chatId = chatIdFor({
      phone: input.phone,
      wa_user_id: input.waUserId,
    });
    if (!chatId) return;

    // Grupo tem nome próprio, já tratado pelo webhook; e consultar o
    // endpoint de contatos com um JID de grupo devolve 404.
    if (input.phone?.startsWith('group:')) return;

    const patch: Record<string, unknown> = {};

    // ---- nome ----
    const phoneDigits = (input.phone ?? '').replace(/\D/g, '');
    const nameIsPlaceholder =
      !input.name?.trim() || input.name.trim() === phoneDigits;
    const nameIsEditable = input.nameSource !== 'manual';

    if (nameIsPlaceholder && nameIsEditable) {
      const whatsappName = await fetchContactName(chatId);
      if (whatsappName && whatsappName !== input.name) {
        patch.name = whatsappName;
        patch.name_source = 'whatsapp';
      } else if (!whatsappName) {
        // O WAHA não conhece este contato. Marcar que tentamos evita uma
        // consulta de rede a CADA mensagem recebida — o custo de um nome
        // ausente não pode virar uma chamada por mensagem, para sempre.
        // `avatar_synced_at` é o carimbo que a listagem já usa para
        // ordenar quem ainda não foi visto.
        patch.avatar_synced_at = new Date().toISOString();
      }
    }

    // ---- foto ----
    // Só busca quando este contato nunca teve a foto tentada. Sem essa
    // guarda, cada mensagem recebida faria uma chamada de rede ao CDN do
    // WhatsApp — e a maioria dos contatos não tem foto, então a chamada
    // seria repetida para sempre sem nunca produzir resultado.
    if (!input.avatarSyncedAt) {
      const picture = await wahaGetChatPicture(chatId).catch(() => null);
      if (picture) {
        const stored = await storePhoto(db, input.contactId, picture);
        if (stored) patch.avatar_url = stored;
      }
      // Carimba mesmo quando não há foto: "tentamos e não tem" é estado
      // final, e é o que impede a consulta repetida.
      patch.avatar_synced_at = new Date().toISOString();
    }

    if (Object.keys(patch).length === 0) return;

    await db.from('contacts').update(patch).eq('id', input.contactId);
  } catch (err) {
    // Silencioso de propósito: o chamador é o webhook, no caminho da
    // mensagem do cliente. Um log basta.
    console.warn(
      '[contact-enrich] falhou para o contato',
      input.contactId,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Copia a foto para o nosso Storage e devolve a URL pública.
 *
 * Copiar, e não guardar o link: as URLs de `pps.whatsapp.net` carregam
 * assinatura e expiram em ~2 dias. Um link direto daria um avatar que
 * funciona hoje e some na semana que vem.
 */
async function storePhoto(
  db: SupabaseClient,
  contactId: string,
  picture: { url: string }
): Promise<string | null> {
  const res = await fetch(picture.url);
  if (!res.ok) return null;

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_PHOTO_BYTES) return null;

  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
  const path = `contacts/${contactId}.${ext}`;

  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: ct || 'image/jpeg', upsert: true });
  if (error) return null;

  const { data } = db.storage.from(BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}
