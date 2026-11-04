'use client';

// ============================================================
// Uma única subscription para a contagem de não-lidas.
//
// O sino (cabeçalho) e o badge (menu lateral) precisam do mesmo número.
// Chamar `useTotalUnread()` nos dois criava DUAS subscriptions em
// `conversations` — tráfego dobrado, e no caso de nomes de canal
// repetidos, um erro que derrubava a página inteira (ver o comentário em
// use-total-unread.ts).
//
// O provider é montado uma vez pelo dashboard shell e expõe o valor por
// contexto. Assim existe exatamente uma conexão realtime, e um número
// só, sem chance de o sino e o menu discordarem.
// ============================================================

import { createContext, useContext } from 'react';

import { useTotalUnread } from '@/hooks/use-total-unread';

const UnreadCountContext = createContext<number>(0);

export function UnreadCountProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const total = useTotalUnread();
  return (
    <UnreadCountContext.Provider value={total}>
      {children}
    </UnreadCountContext.Provider>
  );
}

/**
 * Contagem de conversas com mensagem não lida.
 *
 * Devolve 0 sem provider em vez de estourar: o header também é usado em
 * telas fora do dashboard shell (e em testes isolados), onde um sino
 * vazio é a resposta correta — não um crash.
 */
export function useUnreadCount(): number {
  return useContext(UnreadCountContext);
}
