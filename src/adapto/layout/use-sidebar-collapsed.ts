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

import { useCallback, useSyncExternalStore } from 'react';

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

// ------------------------------------------------------------
// Assinatura para o useSyncExternalStore.
//
// Por que não `useState` + `useEffect`: a regra
// `react-hooks/set-state-in-effect` (eslint-plugin-react-hooks v7) trata
// `setState` síncrono dentro de efeito como erro, e com razão — ele
// dispara um segundo render em cascata logo após a pintura.
//
// `useSyncExternalStore` é o primitivo que o React oferece exatamente para
// ler uma fonte externa (localStorage) sem divergir na hidratação: ele
// recebe um `getServerSnapshot` separado, então o servidor renderiza
// `false` e o cliente reconcilia sozinho.
// ------------------------------------------------------------

/** Ouvintes avisados quando a preferência muda (inclui outras abas). */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // `storage` só dispara em OUTRAS abas; para a mesma aba avisamos em
  // `notify()`, chamado pela escrita.
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Estado do colapso do menu lateral.
 *
 * O servidor sempre renderiza expandido; o cliente aplica a preferência
 * salva na primeira leitura, sem render extra e sem erro de hidratação.
 */
export function useSidebarCollapsed(): {
  collapsed: boolean;
  toggle: () => void;
} {
  const collapsed = useSyncExternalStore(
    subscribe,
    readCollapsedPreference,
    // Snapshot do servidor: o layout foi desenhado para o menu expandido.
    () => false
  );

  const toggle = useCallback(() => {
    writeCollapsedPreference(!readCollapsedPreference());
    notify();
  }, []);

  return { collapsed, toggle };
}
