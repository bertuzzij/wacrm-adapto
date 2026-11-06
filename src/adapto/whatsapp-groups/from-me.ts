// ============================================================
// Mensagem enviada pelo próprio número, em conversa individual.
//
// O caso: o atendente responde pelo celular e quer ver isso no CRM. O WAHA
// entrega o evento, mas com um formato diferente do de grupo:
//
//   grupo:       from = "<grupo>@g.us"          to = null
//   individual:  from = "<lid>@lid"   (o MEU)   to = null
//
// Em individual o `from` NÃO é a pessoa com quem se está falando — é o
// identificador opaco do próprio número, e o `to` vem nulo. Sem descobrir o
// destinatário, a mensagem não tem onde ser gravada.
//
// O destinatário sai do `_data.Info.Chat`, que nesse caso traz o LID do
// contato (confundido com o do número quando lido depressa). Esse LID é
// traduzido para telefone pelo endpoint `/lids/` do WAHA.
//
// Módulo puro: a extração do LID e a escolha do formato de saída são
// testáveis sem rede.
// ============================================================

/** O que o payload do WAHA traz de relevante para o caso fromMe. */
export interface FromMePayload {
  from?: string;
  to?: string | null;
  participant?: string | null;
  /**
   * `_data` é um saco de campos no payload do WAHA, com chaves que variam
   * por build. O índice aberto existe para aceitar o `WahaPayload` real sem
   * um cast no chamador; só `Info` é lido.
   */
  _data?: {
    Info?: {
      Chat?: string;
      Sender?: string;
      RecipientAlt?: string;
      IsGroup?: boolean;
    };
    [key: string]: unknown;
  };
}

/** True para um identificador opaco do WhatsApp (`<digits>@lid`). */
export function isLid(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().endsWith('@lid');
}

/**
 * O identificador do CONTATO com quem a conversa está acontecendo.
 *
 * Ordem de preferência, e o motivo de cada uma:
 *
 *   1. `_data.Info.Chat` — é o campo que descreve a conversa; em `fromMe`
 *      individual ele traz o LID do contato.
 *   2. `payload.to` — em alguns builds o destinatário aparece aqui.
 *   3. `_data.Info.RecipientAlt` — variação de build.
 *
 * Devolve `null` quando nada serve (ex.: o Chat é igual ao Sender, o que
 * significa que o WAHA não sabe o destinatário). Melhor não gravar do que
 * gravar uma mensagem na conversa errada.
 */
export function contactIdForFromMe(payload: FromMePayload): string | null {
  const info = payload._data?.Info ?? {};
  // O próprio número, para nunca confundir o destinatário com ele.
  const self = info.Sender?.trim();

  const candidates = [
    info.Chat,
    payload.to ?? undefined,
    info.RecipientAlt,
  ];

  for (const raw of candidates) {
    const value = (raw ?? '').trim();
    if (!value) continue;
    if (value === self) continue;
    // `status@` e newsletter não são conversa.
    if (value.startsWith('status@') || value.endsWith('@newsletter')) continue;
    return value;
  }

  return null;
}

/**
 * Telefone a partir da resposta do `/lids/`.
 *
 * O endpoint devolve `{ lid, pn }`, onde `pn` é `"<digits>@c.us"`.
 * Devolve `null` quando a resposta não traz um telefone utilizável.
 */
export function phoneFromLidResponse(response: unknown): string | null {
  const pn = (response as { pn?: string } | null)?.pn;
  if (typeof pn !== 'string') return null;

  const digits = pn.split('@')[0].replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}
