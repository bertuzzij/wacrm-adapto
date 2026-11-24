import { describe, expect, it } from 'vitest'

import { isStanzaMessageId, stanzaMessageId } from './message-key'

// ============================================================
// Ids reais do banco, copiados das duplicatas de 24/11/2026. O par
// (envio, eco) da MESMA mensagem é o caso que o teste precisa congelar.
// ============================================================

const GRUPO = '5511971415149-1593719147@g.us'
const STANZA = '3EB0C2C90EF17FD9D02D07'

/** O que o /api/sendText gravou no envio. */
const ID_ENVIO = `true_${GRUPO}_${STANZA}`

/** O que o eco do webhook gravou (versões anteriores: com telefone). */
const ID_ENVIO_ANTIGO = `true_${GRUPO}_${STANZA}_5516996066156@c.us`

/** O que o eco grava hoje. */
const ID_ECO_LID = `true_${GRUPO}_${STANZA}_39788627423277@lid`

describe('stanzaMessageId', () => {
  it('reduz o eco com LID ao stanza', () => {
    expect(stanzaMessageId(ID_ECO_LID)).toBe(ID_ENVIO)
  })

  it('reduz o id antigo com telefone ao stanza', () => {
    expect(stanzaMessageId(ID_ENVIO_ANTIGO)).toBe(ID_ENVIO)
  })

  it('faz envio e eco convergirem — a razão de existir da função', () => {
    // Se este teste falhar, a duplicata volta: os dois caminhos gravam ids
    // diferentes e o índice único (conversation_id, message_id) não bloqueia.
    expect(stanzaMessageId(ID_ECO_LID)).toBe(stanzaMessageId(ID_ENVIO_ANTIGO))
  })

  it('é idempotente no id já normalizado', () => {
    expect(stanzaMessageId(ID_ENVIO)).toBe(ID_ENVIO)
    expect(stanzaMessageId(stanzaMessageId(ID_ECO_LID))).toBe(ID_ENVIO)
  })

  it('preserva mensagem recebida (fromMe=false) e o mesmo stanza', () => {
    const recebida = `false_${GRUPO}_${STANZA}_5511999999999@c.us`
    expect(stanzaMessageId(recebida)).toBe(`false_${GRUPO}_${STANZA}`)
  })

  it('NÃO mexe em conversa individual', () => {
    // `true_5516982594845@c.us_3EB04383E41021006D20CF`: o segundo segmento
    // é telefone, não @g.us. Cortar ali destruiria a chave.
    const individual = 'true_5516982594845@c.us_3EB04383E41021006D20CF'
    expect(stanzaMessageId(individual)).toBe(individual)
  })

  it('NÃO mexe em conversa individual com LID', () => {
    const individual = 'false_225180907491573@lid_3EB0DC117AD84B54019CD5'
    expect(stanzaMessageId(individual)).toBe(individual)
  })

  it('não inventa formato: id curto ou vazio volta intacto', () => {
    expect(stanzaMessageId('')).toBe('')
    expect(stanzaMessageId('3EB0ABC')).toBe('3EB0ABC')
    expect(stanzaMessageId('true_5511999999999@c.us')).toBe(
      'true_5511999999999@c.us',
    )
  })

  it('tolera espaços em volta', () => {
    expect(stanzaMessageId(`  ${ID_ECO_LID}  `)).toBe(ID_ENVIO)
  })

  it('não confunde @g.us no meio do id com conversa de grupo', () => {
    // Só o SEGUNDO segmento é a conversa; um sufixo parecido adiante em
    // conversa individual não pode disparar o corte.
    const estranho = 'true_5511999999999@c.us_3EB0_abc@g.us'
    expect(stanzaMessageId(estranho)).toBe(estranho)
  })
})

describe('isStanzaMessageId', () => {
  it('reconhece o formato de três segmentos', () => {
    expect(isStanzaMessageId(ID_ENVIO)).toBe(true)
  })

  it('recusa o formato com participante', () => {
    expect(isStanzaMessageId(ID_ECO_LID)).toBe(false)
    expect(isStanzaMessageId(ID_ENVIO_ANTIGO)).toBe(false)
  })
})
