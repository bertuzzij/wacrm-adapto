// ============================================================
// A janela de mensagens de 24 horas, e quando ela vale.
//
// A regra existe na API oficial da Meta: fora de 24h desde a última
// mensagem do CLIENTE, a Meta recusa texto livre. O CRM implementa essa
// regra — mas só no cliente, em `message-thread.tsx`, que desabilita o
// compositor quando a conta de horas estoura.
//
// O WAHA não tem essa janela. Usando WAHA, a mensagem passaria; é o CRM
// que se auto-limita e impede o atendente de responder. Este módulo
// existe para a regra virar opcional, sem tocar no motor de envio:
// a decisão é só de interface.
//
// `enforce = false` NÃO libera nada na Meta. Se a conta usa a API
// oficial, deixar ligado é o comportamento correto — fora da janela a
// própria Meta devolve erro.
// ============================================================

/** Janela de atendimento da Meta: 24 horas desde a última mensagem do cliente. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * O que a interface deve mostrar sobre a janela.
 *
 * `labelKey` continua sendo o nome cru da chave em `Inbox.sessionTimer`
 * — traduzir aqui quebraria a busca da chave, mesmo princípio de
 * `statusLabelKey` em `conversation-status.ts`.
 */
export interface MessagingWindowState {
  /** Fora da janela: o compositor fica bloqueado. */
  expired: boolean;
  /** Chave em `Inbox.sessionTimer` com o texto a exibir. */
  labelKey: 'expired' | 'xhRemaining' | 'xmRemaining' | 'noCustomerMessages' | 'noWindow';
  /** Só em `xhRemaining`. */
  hours?: number;
  /** Só em `xmRemaining`. */
  minutes?: number;
}

/**
 * Traduz "quando foi a última mensagem do cliente" no estado da janela.
 *
 * Com `enforce` falso a janela não existe: nunca expira, e o rótulo diz
 * isso em vez de mostrar uma contagem regressiva de algo que não vale.
 *
 * Com `enforce` verdadeiro o comportamento é exatamente o que existia
 * antes desta mudança — inclusive o caso "nenhuma mensagem do cliente",
 * que bloqueia o compositor.
 */
export function resolveMessagingWindow(
  enforce: boolean,
  lastCustomerMessageAt: Date | null,
  now: Date
): MessagingWindowState {
  if (!enforce) return { expired: false, labelKey: 'noWindow' };

  if (!lastCustomerMessageAt) {
    return { expired: true, labelKey: 'noCustomerMessages' };
  }

  const elapsed = now.getTime() - lastCustomerMessageAt.getTime();
  if (elapsed >= WINDOW_MS) return { expired: true, labelKey: 'expired' };

  // Restante em horas arredondado para baixo, como antes: 23h30 vira
  // "23h restantes" e os minutos só aparecem na última hora.
  const hoursLeft = (WINDOW_MS - elapsed) / (60 * 60 * 1000);
  if (hoursLeft >= 1) {
    return { expired: false, labelKey: 'xhRemaining', hours: Math.floor(hoursLeft) };
  }
  return {
    expired: false,
    labelKey: 'xmRemaining',
    minutes: Math.floor(hoursLeft * 60),
  };
}

/**
 * Se o filtro "Janela fechando" faz sentido nesta conta.
 *
 * Com a janela desligada esse filtro fica permanentemente vazio, o que
 * parece defeito. Esconder a opção é mais honesto que mostrar uma lista
 * que nunca vai encher.
 */
export function expiringFilterApplies(enforce: boolean): boolean {
  return enforce;
}
