'use client';

// ============================================================
// Estado do menu lateral colapsado.
//
// O menu tem 240px fixos no desktop. Numa inbox — que é a tela onde o
// atendente passa o dia, com lista de conversas + thread + painel de
// contato — esses 240px são exatamente o que falta para o painel do
// contato não sobrepor a conversa.
//
// A escolha é guardada no `localStorage`, não na conta: é preferência de
// TELA, como o zoom, e não deveria viajar para o outro computador da
// equipe (nem custar uma coluna no banco, nem um round-trip).
//
// O padrão é expandido: quem nunca mexeu vê o menu como sempre foi.
// ============================================================

import { useCallback, useEffect, useState } from 'react';

/** Chave do localStorage. Versionada para permitir mudar o formato depois. */
const STORAGE_KEY = 'adapto.sidebar.collapsed.v1';

/** Largura quando colapsado — só os ícones, alvo de toque confortável. */
export const COLLAPSED_WIDTH_PX = 64;

/**
 * Lê a preferência salva.
 *
 * Devolve `false` em qualquer dúvida: ambiente sem `localStorage` (SSR),
 * valor corrompido, chave ausente. O menu nasce expandido, que é o estado
 * para o qual o layout foi desenhado.
 */
export function readCollapsedPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Modo restrito / storage bloqueado: segue com o padrão.
    return false;
  }
}

/** Grava a preferência. Falha silenciosa: o menu funciona sem persistir. */
export function writeCollapsedPreference(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(collapsed));
  } catch {
    // Sem storage a preferência vale só nesta sessão. Aceitável.
  }
}

/**
 * Hook do estado de colapso.
 *
 * Começa sempre `false` para o primeiro render do servidor e do cliente
 * coincidirem — ler o `localStorage` no `useState` inicial faria o HTML
 * do servidor divergir do primeiro render do cliente (erro de hidratação).
 * A preferência real é aplicada no efeito, logo depois.
 */
export function useSidebarCollapsed(): {
  collapsed: boolean;
  toggle: () => void;
} {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(readCollapsedPreference());
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      writeCollapsedPreference(next);
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
