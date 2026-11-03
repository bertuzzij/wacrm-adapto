import { describe, expect, it } from 'vitest'
import { matchOption, nativeReply, optionsOf } from './waha-reply'

const options = [
  { id: 'btn_sim', title: 'Sim' },
  { id: 'btn_nao', title: 'Não' },
  { id: 'btn_talvez', title: 'Talvez' },
]

describe('matchOption', () => {
  it('maps a number to the option at that position', () => {
    expect(matchOption(options, '2')?.id).toBe('btn_nao')
    expect(matchOption(options, ' 3 ')?.id).toBe('btn_talvez')
  })

  it('returns null for a number out of range', () => {
    expect(matchOption(options, '4')).toBeNull()
    expect(matchOption(options, '0')).toBeNull()
  })

  it('matches by title ignoring case and accents', () => {
    expect(matchOption(options, 'nao')?.id).toBe('btn_nao')
    expect(matchOption(options, 'SIM')?.id).toBe('btn_sim')
  })

  it('matches by id and rejects unrelated text', () => {
    expect(matchOption(options, 'btn_talvez')?.title).toBe('Talvez')
    expect(matchOption(options, 'oi, tudo bem?')).toBeNull()
    expect(matchOption(options, '')).toBeNull()
  })
})

describe('optionsOf', () => {
  it('flattens list sections in order', () => {
    const flat = optionsOf({
      kind: 'list',
      body: 'x',
      button_label: 'Ver',
      sections: [
        { title: 'A', rows: [{ id: 'a1', title: 'A1' }] },
        { rows: [{ id: 'b1', title: 'B1' }, { id: 'b2', title: 'B2' }] },
      ],
    })
    expect(flat.map((o) => o.id)).toEqual(['a1', 'b1', 'b2'])
  })

  it('returns buttons as options', () => {
    const flat = optionsOf({ kind: 'buttons', body: 'x', buttons: options })
    expect(flat).toHaveLength(3)
  })
})

describe('nativeReply', () => {
  it('reads a WEBJS button answer', () => {
    expect(
      nativeReply({ type: 'buttons_response', selectedButtonId: 'btn_sim', body: 'Sim' }),
    ).toEqual({ id: 'btn_sim', title: 'Sim' })
  })

  it('reads a WEBJS list answer', () => {
    expect(
      nativeReply({
        listResponse: { title: 'A1', singleSelectReply: { selectedRowId: 'a1' } },
      }),
    ).toEqual({ id: 'a1', title: 'A1' })
  })

  it('reads GOWS button and list answers', () => {
    expect(
      nativeReply({
        Message: {
          buttonsResponseMessage: { selectedButtonID: 'b', selectedDisplayText: 'B' },
        },
      }),
    ).toEqual({ id: 'b', title: 'B' })
    expect(
      nativeReply({
        Message: {
          listResponseMessage: { title: 'L', singleSelectReply: { selectedRowID: 'r' } },
        },
      }),
    ).toEqual({ id: 'r', title: 'L' })
  })

  it('returns null for ordinary messages', () => {
    expect(nativeReply({ type: 'chat' })).toBeNull()
    expect(nativeReply(null)).toBeNull()
    expect(nativeReply('x')).toBeNull()
  })
})
