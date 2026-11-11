// ============================================================
// Deve este SMS ser encaminhado ao WhatsApp?
//
// NECESSIDADE: receber no WhatsApp os códigos 2FA da Amplimed, porque o
// atendente às vezes está longe do celular. O WAHA não escuta SMS — quem
// escuta é um app no Android — então este servidor é o relay.
//
// O remetente do SMS VARIA (operadora, gateway curto, número longo), e
// por isso NÃO é usado como critério. O critério é o CORPO: os SMS da
// Amplimed têm formato estável, verificado em produção:
//
//   "Seu codigo de validacao Amplimed e: 308911"
//
// Filtrar pelo corpo é o que impede que QUALQUER SMS do celular (banco,
// transportadora, família) transborde para o WhatsApp — o relay é uma
// porta estreita de propósito.
// ============================================================

/**
 * Prefixo que identifica um SMS de validação da Amplimed.
 *
 * Sem acento de propósito: o SMS chega exatamente assim — o remetente
 * "9150000" envia "codigo" e "validacao" sem acentuar, e a comparação é
 * case-insensitive para tolerar variação de caixa entre gateways.
 */
export const AMPLIMED_SMS_PREFIX = 'seu codigo de validacao amplimed e:';

/** SMS de validação típico: 6 dígitos. Aceita 4 a 8 por segurança. */
const CODE_PATTERN = /\b\d{4,8}\b/;

export interface SmsForwardDecision {
  forward: boolean;
  /** O código extraído do corpo, quando identificado. */
  code: string | null;
  /** Motivo da decisão — aparece no log do servidor. */
  reason: 'match' | 'no-match' | 'no-code';
}

/**
 * Decide se um SMS deve ser replicado, e extrai o código.
 *
 * A extração é separada do encaminhamento porque o código é a ÚNICA parte
 * que importa: encaminhar o SMS inteiro é aceitável, mas quem está do
 * outro lado quer o número, e vê-lo em destaque evita ler a frase toda
 * com pressa.
 */
export function shouldForwardSms(body: string | null | undefined): SmsForwardDecision {
  const text = (body ?? '').trim();
  if (!text.toLowerCase().startsWith(AMPLIMED_SMS_PREFIX)) {
    return { forward: false, code: null, reason: 'no-match' };
  }

  const code = text.match(CODE_PATTERN)?.[0] ?? null;
  if (!code) {
    // Casou no prefixo mas sem código: encaminha do mesmo jeito. É SMS da
    // Amplimed; perder um código por variação de formato é pior que
    // receber a frase inteira.
    return { forward: true, code: null, reason: 'no-code' };
  }

  return { forward: true, code, reason: 'match' };
}

/**
 * Mensagem formatada para o WhatsApp.
 *
 * O texto do SMS vai inteiro (contexto em caso de variação de formato),
 * e o código vem isolado numa linha própria em destaque — é o que se digita
 * com pressa na tela do computador.
 */
export function formatSmsRelayMessage(
  body: string,
  code: string | null,
  receivedAt = new Date()
): string {
  const stamp = receivedAt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const header = code ? `🔐 *Código Amplimed: ${code}*` : '📱 SMS da Amplimed';
  return `${header}\n\n${body.trim()}\n\n_Recebido às ${stamp}_`;
}

/** Formato que o WAHA espera: só dígitos + `@c.us`. */
export function selfChatId(phone: string): string {
  return `${phone.replace(/\D/g, '')}@c.us`;
}
