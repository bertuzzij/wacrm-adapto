'use client';

// ============================================================
// "Esta conta aplica a janela de 24h?"
//
// O valor mora em `accounts.enforce_messaging_window` e é lido por dois
// lugares na mesma tela: o compositor (para bloquear ou não) e o filtro
// da lista (para mostrar ou não o chip "Janela fechando"). Duas leituras
// duplicadas seriam duas idas ao banco por render.
//
// Por isso o mesmo padrão de `lib/ai/account-status-cache.ts`: um cache
// de módulo com TTL curto. Não é cache de estado da aplicação, é só
// evitar consulta repetida dentro da mesma sessão de tela.
//
// Enquanto a leitura não termina, o padrão é `true` — o comportamento
// seguro é manter a regra que já existia, nunca liberar por omissão.
// ============================================================

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

/** Quanto tempo um valor lido vale antes de nova consulta. */
export const MESSAGING_WINDOW_TTL_MS = 30_000;

const cache = new Map<string, { enabled: boolean; expiresAt: number }>();

/** Só para testes, e para o painel avisar que o valor mudou. */
export function invalidateMessagingWindow(accountId?: string): void {
  if (accountId) cache.delete(accountId);
  else cache.clear();
}

/**
 * Lê o flag da conta.
 *
 * Qualquer falha de leitura devolve `true`: é melhor a tela continuar
 * avisando da janela do que liberar envio por causa de um erro de rede.
 */
export async function fetchMessagingWindowEnabled(
  accountId: string,
  now: () => number = Date.now
): Promise<boolean> {
  const cached = cache.get(accountId);
  if (cached && cached.expiresAt > now()) return cached.enabled;

  try {
    const { data, error } = await createClient()
      .from('accounts')
      .select('enforce_messaging_window')
      .eq('id', accountId)
      .maybeSingle();

    if (error || !data) return true;

    // Uma linha lida antes da migração 062 não tem a coluna: ausência
    // significa "não configurado", e o padrão é ligado.
    const enabled = data.enforce_messaging_window !== false;
    cache.set(accountId, { enabled, expiresAt: now() + MESSAGING_WINDOW_TTL_MS });
    return enabled;
  } catch {
    return true;
  }
}

/**
 * Versão de hook, para componentes.
 *
 * `enabled` começa em `true` e só muda depois da leitura — assim o
 * primeiro render nunca mostra um compositor liberado por engano.
 */
export function useMessagingWindowEnabled(accountId: string | null | undefined): boolean {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    fetchMessagingWindowEnabled(accountId).then((value) => {
      if (!cancelled) setEnabled(value);
    });

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return enabled;
}
