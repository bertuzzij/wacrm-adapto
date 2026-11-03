// ============================================================
// Como uma mensagem interativa é entregue pelo WAHA.
//
// O motor GOWS (o que a VPS roda) implementa /api/sendList mas NÃO
// implementa /api/sendButtons:
//
//   POST /api/sendList     -> 201, gera listMessage nativo
//                             (no celular: bolha com o botão "Ver opções")
//   POST /api/sendButtons  -> 501 "The method is not implemented by 'GOWS'"
//
// Ou seja: lista nativa funciona, botão nativo não. Antes existiam só três
// modos e o padrão era `poll`, então TODA lista e TODO botão viravam
// enquete. Duas consequências ruins:
//
//   1. O agente pedia uma lista com seções e recebia uma enquete, sem as
//      seções (as opções eram achatadas numa única pergunta).
//   2. O botão nunca era entregue como botão — virava enquete ou, quando
//      a enquete falhava, um menu de texto numerado.
//
// O modo `list` (novo padrão) usa o caminho que o motor realmente suporta:
// manda lista como lista e converte botão em lista de uma seção. Nos dois
// casos o cliente vê o mesmo botão "Ver opções" e toca na opção. Quando o
// envio nativo é recusado, ainda cai para enquete e, por último, texto —
// nessa ordem, do mais parecido com o pedido para o mais simples.
// ============================================================

/** Como o WAHA entrega botões e listas. */
export type WahaInteractiveStrategy = 'native' | 'poll' | 'text'

/** Modo configurável por `WAHA_INTERACTIVE_MODE`. */
export type WahaInteractiveMode = 'poll' | 'buttons' | 'list' | 'text'

export const DEFAULT_INTERACTIVE_MODE: WahaInteractiveMode = 'list'

/** Normaliza o valor da env var; qualquer coisa desconhecida vira o padrão. */
export function parseInteractiveMode(raw: string | undefined): WahaInteractiveMode {
  const v = raw?.trim().toLowerCase()
  if (v === 'poll' || v === 'buttons' || v === 'list' || v === 'text') return v
  return DEFAULT_INTERACTIVE_MODE
}

/**
 * Ordem das tentativas de envio, da mais fiel ao pedido para a mais simples.
 *
 * `buttons` mantém a lista como reserva porque o 501 do GOWS é certo, não
 * intermitente: tentar botão primeiro e cair na lista é o que entrega o
 * resultado desejado em vez de degradar direto para texto.
 */
export function interactiveStrategies(
  mode: WahaInteractiveMode
): WahaInteractiveStrategy[] {
  switch (mode) {
    case 'text':
      return ['text']
    case 'poll':
      return ['poll', 'text']
    case 'buttons':
      return ['native', 'poll', 'text']
    case 'list':
    default:
      return ['native', 'poll', 'text']
  }
}

/**
 * Converte botões numa lista de uma seção.
 *
 * O cliente vê o mesmo botão "Ver opções" e escolhe uma opção; a diferença
 * é só que a lista tem um único grupo. Usado quando o motor recusa
 * `/api/sendButtons`, para não perder as opções nem virar enquete.
 *
 * Devolve `null` quando não há como montar uma lista válida — o WAHA exige
 * ao menos uma seção com ao menos uma linha, então zero botões não vira
 * lista e o chamador deve seguir para a próxima estratégia.
 */
export function buttonsAsList(
  buttons: Array<{ id: string; title: string }>
): { buttonLabel: string; sections: Array<{ rows: Array<{ id: string; title: string }> }> } | null {
  const rows = buttons.filter((b) => b.title.trim().length > 0)
  if (rows.length === 0) return null
  return {
    buttonLabel: 'Ver opções',
    sections: [{ rows: rows.map((b) => ({ id: b.id, title: b.title })) }],
  }
}

/**
 * Título da enquete quando o envio nativo falha.
 *
 * O WhatsApp limita o nome da enquete a 250 caracteres e a API recusa
 * (HTTP 500) quando faltam `name` ou `options`. A lista de opções também
 * precisa ser não-vazia, senão a enquete nasce sem opção.
 */
export function pollPayloadFor(
  headerText: string | undefined,
  bodyText: string,
  groups: Array<{ options: Array<{ title: string }> }>
): { name: string; options: string[] } | null {
  const options = groups
    .flatMap((g) => g.options.map((o) => o.title))
    .map((t) => t.trim())
    .filter(Boolean)

  if (options.length === 0) return null

  const name = [headerText, bodyText]
    .filter(Boolean)
    .join('\n')
    .trim()
    .slice(0, 250)

  return { name: name || options[0], options }
}
