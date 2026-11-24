// ============================================================
// Identidade estável de uma mensagem de grupo.
//
// O WAHA identifica uma mensagem com até quatro segmentos:
//
//   true_5511971415149-1593719147@g.us_3EB0C2C90EF17FD9D02D07_5516996066156@c.us
//   └─┬┘ └──────────── JID da conversa ────────┘ └────── stanza ──────┘ └─ participante ─┘
//
// O primeiro segmento diz se a mensagem é nossa (`true`) ou de outra pessoa
// (`false`); o segundo é a conversa; o terceiro é o **stanza**, que é o
// identificador que o próprio WhatsApp usa para a mensagem; o quarto
// identifica quem enviou.
//
// O PROBLEMA (24/11/2026)
//
// O último segmento não é estável entre os dois caminhos que gravam a mesma
// mensagem, nem entre versões do WAHA:
//
//   envio pelo CRM   /api/sendText devolvia   …_5516996066156@c.us
//   eco do webhook   payload.id trazia        …_39788627423277@lid
//
// Mesmo número, dois identificadores: o telefone e o LID. Como o banco
// deduplica por `(conversation_id, message_id)` — strings diferentes — a
// mesma mensagem virava duas linhas. Medido: zero duplicatas em 119 envios
// até 23/11, e 10 de 10 duplicados em 24/11 após atualizar o WAHA para
// 2026.10.1.
//
// A ATUALIZAÇÃO TAMBÉM QUEBROU O ACK
//
// O `/api/sendText` passou a devolver o id SEM o quarto segmento, enquanto
// as mensagens antigas no banco têm quatro. O ack das antigas procura um id
// de três segmentos, não encontra, e a mensagem fica para sempre em `sent`
// (47 confirmações parqueadas em `pending_message_statuses`).
//
// A SOLUÇÃO
//
// A identidade de uma mensagem é o stanza. Tudo depois dele descreve o
// remetente — informação que já mora em `author_wa_id` (migração 069) e em
// `sender_id`, e que não deve participar da chave.
//
// Normalizar aqui faz os dois caminhos convergirem: o índice único volta a
// deduplicar, o ack volta a encontrar a mensagem, e o id deixa de depender
// da versão do WAHA.
//
// Módulo puro: testável sem rede nem banco.
// ============================================================

/** Quantos segmentos do id o stanza ocupa (`<fromMe>_<conversa>_<stanza>`). */
const STANZA_SEGMENTS = 3;

/**
 * O stanza de uma mensagem de grupo, ou o próprio id quando não for de grupo.
 *
 * Devolve o id intacto para:
 *   - conversa individual (`…@c.us`, `…@lid`), onde o último segmento é
 *     parte da identidade e sempre foi estável;
 *   - qualquer formato com menos de três segmentos, que não é o que o WAHA
 *     entrega e por isso não deve ser reescrito no escuro.
 *
 * Idempotente: um id já normalizado volta igual.
 */
export function stanzaMessageId(messageId: string): string {
  const raw = (messageId ?? '').trim();
  if (!raw) return raw;

  const parts = raw.split('_');
  if (parts.length < STANZA_SEGMENTS) return raw;

  // Só grupo: o segundo segmento precisa ser o JID da conversa. Em
  // individual o segundo segmento é um telefone (`5511999999999@c.us`), e
  // cortar ali destruiria a chave — o formato individual nunca precisou
  // disso porque os dois caminhos sempre concordaram nele.
  const conversation = parts[1];
  if (!conversation.endsWith('@g.us')) return raw;

  return parts.slice(0, STANZA_SEGMENTS).join('_');
}

/** True quando o id já está no formato de stanza (não tem 4º segmento). */
export function isStanzaMessageId(messageId: string): boolean {
  return stanzaMessageId(messageId) === (messageId ?? '').trim();
}
