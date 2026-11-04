'use client';

// ============================================================
// Uma única subscription para cada contagem do sino.
//
// O sino (cabeçalho) e o badge (menu lateral) precisam dos mesmos números.
// Chamar os hooks em cada componente criava DUAS subscriptions nas mesmas
// tabelas — tráfego dobrado e, no caso de nomes de canal repetidos, um
// erro que derrubava a página inteira (ver use-total-unread.ts).
//
// Aqui existem duas contagens, de origens distintas:
//
//   unreadConversations  — conversas com mensagem do cliente esperando
//                          (`conversations.unread_count`)
//   unreadNotifications  — eventos dirigidos ao agente, hoje só
//                          "conversa atribuída" (`notifications`)
//
// O provider monta cada hook UMA vez e distribui por contexto. Assim há
// exatamente uma conexão por tabela, e nenhuma chance de o sino e o menu
// mostrarem números diferentes.
// ============================================================

import { createContext, useContext } from 'react';

import { useTotalUnread } from '@/hooks/use-total-unread';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';

interface BellCounts {
  unreadConversations: number;
  unreadNotifications: number;
}

const DEFAULTS: BellCounts = {
  unreadConversations: 0,
  unreadNotifications: 0,
};

const BellCountsContext = createContext<BellCounts>(DEFAULTS);

export function UnreadCountProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Cada hook é chamado uma única vez em todo o app, aqui.
  const unreadConversations = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  return (
    <BellCountsContext.Provider
      value={{ unreadConversations, unreadNotifications }}
    >
      {children}
    </BellCountsContext.Provider>
  );
}

/**
 * Contagens do sino.
 *
 * Devolve zeros sem provider em vez de estourar: o header também é usado
 * em telas fora do dashboard shell (e em testes isolados), onde um sino
 * vazio é a resposta correta — não um crash.
 */
export function useBellCounts(): BellCounts {
  return useContext(BellCountsContext);
}

/** Só a contagem de conversas não lidas (usada pelo menu lateral). */
export function useUnreadCount(): number {
  return useContext(BellCountsContext).unreadConversations;
}
