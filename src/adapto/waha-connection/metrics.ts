/**
 * Contagens de mensagens para a tela de conexão.
 *
 * Por que estas métricas existem: uma sessão `WORKING` que não entrega nada
 * é exatamente o caso em que alguém abre esta tela. O status do WAHA diz
 * "conectado"; só o banco diz "e as mensagens estão passando?".
 *
 * Escopo: sempre por `account_id` da conversa. `messages` não tem
 * `account_id` próprio — herda pela conversa — então o filtro vai no join.
 * Usa o cliente do chamador (RLS aplicado), não o service role.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MessageCounts {
  received24h: number | null;
  sent24h: number | null;
  failed24h: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Devolve `null` por campo quando a consulta falha, em vez de `0`.
 *
 * A diferença importa na tela: "0 mensagens" é informação ("nada passou
 * hoje"), enquanto `null` é "não consegui contar". Mostrar 0 quando a
 * consulta quebrou faria o usuário achar que o WhatsApp está mudo.
 */
export async function loadMessageCounts(
  db: SupabaseClient,
  accountId: string
): Promise<MessageCounts> {
  const since = new Date(Date.now() - DAY_MS).toISOString();

  // `head: true` + `count: 'exact'` devolve só o número, sem trafegar
  // linhas — estas são contagens, nunca conteúdo.
  //
  // O conector do Supabase é fortemente tipado: em vez de tentar abstrair
  // os três filtros num helper genérico (que brigaria com os tipos do
  // builder), cada contagem monta sua própria consulta. São três linhas
  // repetidas que dizem exatamente o que está sendo contado.
  const countWith = async (
    filter: 'customer' | 'sent' | 'failed'
  ): Promise<number | null> => {
    try {
      let query = db
        .from('messages')
        .select('id, conversations!inner(account_id)', { count: 'exact', head: true })
        .eq('conversations.account_id', accountId)
        .gte('created_at', since);

      if (filter === 'customer') query = query.eq('sender_type', 'customer');
      if (filter === 'sent') query = query.in('sender_type', ['agent', 'bot']);
      if (filter === 'failed') query = query.eq('status', 'failed');

      const { count, error } = await query;
      if (error) return null;
      return typeof count === 'number' ? count : null;
    } catch {
      return null;
    }
  };

  const [received24h, sent24h, failed24h] = await Promise.all([
    countWith('customer'),
    countWith('sent'),
    countWith('failed'),
  ]);

  return { received24h, sent24h, failed24h };
}
