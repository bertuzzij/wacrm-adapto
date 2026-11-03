/**
 * Importa nome e foto de contato a partir do WhatsApp (via WAHA).
 *
 * O que isto NÃO faz, e é importante que fique claro no código e na tela:
 * não escreve no WhatsApp. A API não expõe como definir o nome ou a foto de
 * outra pessoa, então a sincronização é sempre de mão única — WhatsApp -> CRM.
 *
 * Decisões que valem registro:
 *
 *   1. Nome só é sobrescrito se `name_source` for 'whatsapp' ou NULL.
 *      Um nome com `name_source = 'manual'` é intocável. Sem isso, a
 *      sincronização apagaria exatamente o trabalho que a pessoa fez.
 *
 *   2. A foto é COPIADA para o Storage. As URLs de `pps.whatsapp.net`
 *      carregam assinatura e expiram em ~2 dias; guardar o link daria um
 *      avatar que funciona hoje e some na semana que vem.
 *
 *   3. Falha em um contato não aborta a execução. Um contato removido, uma
 *      foto de 5 MB ou um timeout não podem custar os outros 200.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  wahaDownload,
  wahaGetChatPicture,
  wahaListChats,
} from '@/lib/whatsapp/waha';
import { chatIdFor, extFor, resolveName } from './rules';

/**
 * Bucket das fotos de contato — próprio, criado na migration 061.
 *
 * Não é o `avatars`: aquele é avatar de PERFIL de usuário e sua política
 * exige `auth.uid()` como primeiro segmento do caminho. Contato pertence à
 * conta, não a um usuário, então gravar lá é barrado pela RLS.
 */
const BUCKET = 'contact-avatars';

/** Teto de segurança por imagem; o bucket aceita 2 MB. */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Quantos contatos processar por execução. O botão é manual. */
export const DEFAULT_BATCH = 60;

/** Pausa entre contatos, para não martelar o WAHA. */
const THROTTLE_MS = 120;

export interface SyncResult {
  examined: number;
  nameUpdated: number;
  photoUpdated: number;
  /** Contatos sem foto no WhatsApp — não é erro. */
  withoutPhoto: number;
  /** Nomes preservados por serem edições manuais. */
  namePreserved: number;
  failed: number;
  /** Primeiro erro, para a tela mostrar algo acionável. */
  firstError: string | null;
}

interface ContactRow {
  id: string;
  phone: string | null;
  name: string | null;
  wa_user_id: string | null;
  wa_username: string | null;
  name_source: string | null;
}

/**
 * Executa a sincronização de uma conta.
 *
 * Recebe o cliente do chamador (RLS aplicado) em vez de abrir um service
 * role: a rota já está autenticada, e um bug de escopo aqui não deve poder
 * ler contatos de outra conta.
 */
export async function syncContactProfiles(
  db: SupabaseClient,
  accountId: string,
  options: { limit?: number } = {},
): Promise<SyncResult> {
  const limit = Math.min(options.limit ?? DEFAULT_BATCH, 200);

  const result: SyncResult = {
    examined: 0,
    nameUpdated: 0,
    photoUpdated: 0,
    withoutPhoto: 0,
    namePreserved: 0,
    failed: 0,
    firstError: null,
  };

  const fail = (message: string) => {
    result.failed += 1;
    result.firstError ??= message;
  };

  // Nomes da agenda do WhatsApp, indexados por chat id. Uma chamada só,
  // em vez de uma por contato. `contacts/all` não serve aqui: ele traz
  // `pushname` (o nome que o contato escolheu), não o nome que você salvou.
  let bookNames = new Map<string, string>();
  try {
    const chats = await wahaListChats(200, 0);
    bookNames = new Map(
      chats
        .filter((c) => typeof c.name === 'string' && c.name.trim())
        .map((c) => [c.id, c.name!.trim()]),
    );
  } catch (err) {
    // Sem a agenda ainda dá para atualizar fotos; só não dá para o nome.
    // Registramos e seguimos em vez de abortar tudo.
    result.firstError = err instanceof Error ? err.message : 'chats indisponíveis';
  }

  const { data: contacts, error } = await db
    .from('contacts')
    .select('id, phone, name, wa_user_id, wa_username, name_source')
    .eq('account_id', accountId)
    .order('avatar_synced_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  if (!contacts?.length) return result;

  for (const raw of contacts as ContactRow[]) {
    result.examined += 1;
    const chatId = chatIdFor(raw);
    if (!chatId) continue;

    const patch: Record<string, unknown> = {};

    // ---- nome ----
    const decided = resolveName({
      currentName: raw.name,
      currentSource: raw.name_source,
      whatsappName: bookNames.get(chatId) ?? null,
    });
    if (decided) {
      patch.name = decided.name;
      patch.name_source = decided.source;
    } else if (raw.name_source === 'manual' && bookNames.has(chatId)) {
      result.namePreserved += 1;
    }

    // ---- foto ----
    try {
      const picture = await wahaGetChatPicture(chatId);
      if (!picture) {
        result.withoutPhoto += 1;
        // Marca a tentativa para o contato sair da frente da fila
        // (order by avatar_synced_at nullsFirst) e não ser re-tentado
        // antes dos que nunca foram vistos.
        patch.avatar_synced_at = new Date().toISOString();
      } else {
        const { buffer, contentType } = await wahaDownload(picture.url);
        if (buffer.byteLength > MAX_PHOTO_BYTES) {
          throw new Error(`imagem grande demais (${buffer.byteLength} bytes)`);
        }
        const ext = extFor(contentType);
        // Caminho estável por contato, no escopo da conta — o primeiro
        // segmento (`account-<id>`) é o que as políticas do bucket checam
        // (migration 061). Reescrever o mesmo objeto substitui a foto antiga
        // em vez de acumular lixo.
        const path = `account-${accountId}/contacts/${raw.id}.${ext}`;

        const upload = await db.storage
          .from(BUCKET)
          .upload(path, buffer, { contentType, upsert: true });
        if (upload.error) throw new Error(upload.error.message);

        const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
        // Cache-busting: o caminho é estável, então trocar o `?v=` é o que
        // faz o navegador buscar a nova imagem em vez da anterior.
        patch.avatar_url = `${pub.publicUrl}?v=${Date.now()}`;
        patch.avatar_synced_at = new Date().toISOString();
        result.photoUpdated += 1;
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : 'falha ao buscar foto');
    }

    if (Object.keys(patch).length > 0) {
      const { error: updErr } = await db
        .from('contacts')
        .update(patch)
        .eq('id', raw.id)
        .eq('account_id', accountId);
      if (updErr) fail(updErr.message);
      else if (typeof patch.name === 'string') result.nameUpdated += 1;
    }

    await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }

  return result;
}
