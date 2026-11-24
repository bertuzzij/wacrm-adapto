import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applyMessageStatus,
  applyPendingMessageStatuses,
  type IncomingMessageStatus,
} from './message-status-sync'

type Row = Record<string, unknown>

function fakeDb(tables: Record<string, Row[]>) {
  const columnOf = (column: string) =>
    column === 'conversations.account_id' ? 'account_id' : column

  function query(table: string) {
    const filters: ((row: Row) => boolean)[] = []
    let action: { kind: 'select' | 'update' | 'delete'; patch?: Row } = { kind: 'select' }
    const rows = () => (tables[table] ??= [])
    const matching = () => rows().filter((row) => filters.every((f) => f(row)))

    const builder = {
      select() {
        return builder
      },
      update(patch: Row) {
        action = { kind: 'update', patch }
        return builder
      },
      delete() {
        action = { kind: 'delete' }
        return builder
      },
      upsert(row: Row, options: { onConflict: string }) {
        const keys = options.onConflict.split(',')
        const exists = rows().some((r) => keys.every((k) => r[k] === row[k]))
        if (!exists) rows().push({ created_at: new Date().toISOString(), ...row })
        return Promise.resolve({ error: null })
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[columnOf(column)] === value)
        return builder
      },
      neq(column: string, value: unknown) {
        filters.push((row) => row[columnOf(column)] !== value)
        return builder
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[columnOf(column)]))
        return builder
      },
      like(column: string, pattern: string) {
        // Traduz só o que a busca legada usa: `\_` literal seguido de `%`.
        const regex = new RegExp(
          '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\_/g, '_').replace(/%$/, '.*') + '$',
        )
        filters.push((row) => regex.test(String(row[columnOf(column)] ?? '')))
        return builder
      },
      lt(column: string, value: string) {
        filters.push((row) => String(row[column]) < value)
        return builder
      },
      then(resolve: (result: { data: Row[]; error: null }) => unknown) {
        const hit = matching()
        if (action.kind === 'update') hit.forEach((row) => Object.assign(row, action.patch))
        if (action.kind === 'delete') tables[table] = rows().filter((row) => !hit.includes(row))
        return Promise.resolve({ data: hit.map((row) => ({ ...row })), error: null }).then(resolve)
      },
    }
    return builder
  }

  return { from: query } as unknown as SupabaseClient
}

const status = (overrides: Partial<IncomingMessageStatus> = {}): IncomingMessageStatus => ({
  wamid: 'wamid.1',
  status: 'delivered',
  failure: null,
  statusAt: '2026-10-16T10:00:00.000Z',
  ...overrides,
})

function message(overrides: Row = {}): Row {
  return {
    id: 'm1',
    conversation_id: 'c1',
    account_id: 'acc-1',
    message_id: 'wamid.1',
    status: 'sent',
    ...overrides,
  }
}

describe('applyMessageStatus', () => {
  it('advances the row and reports it', async () => {
    const tables = { messages: [message()] }
    const advanced = await applyMessageStatus(fakeDb(tables), 'acc-1', status())
    expect(advanced).toEqual([{ id: 'm1', conversation_id: 'c1', account_id: 'acc-1', message_id: 'wamid.1', status: 'delivered' }])
    expect(tables.messages[0].status).toBe('delivered')
  })

  it('ignores a delivered that arrives after read', async () => {
    const tables = { messages: [message({ status: 'read' })] }
    const advanced = await applyMessageStatus(fakeDb(tables), 'acc-1', status())
    expect(advanced).toEqual([])
    expect(tables.messages[0].status).toBe('read')
  })

  it('ignores a failed that arrives after read, keeping error columns empty', async () => {
    const tables = { messages: [message({ status: 'read' })] }
    await applyMessageStatus(
      fakeDb(tables),
      'acc-1',
      status({ status: 'failed', failure: { code: 131049, title: 'x', details: null } }),
    )
    expect(tables.messages[0].status).toBe('read')
    expect(tables.messages[0]).not.toHaveProperty('error_code')
  })

  it('stores the failure reason alongside a valid failed status', async () => {
    const tables = { messages: [message()] }
    await applyMessageStatus(
      fakeDb(tables),
      'acc-1',
      status({ status: 'failed', failure: { code: 131049, title: 'Blocked', details: 'd' } }),
    )
    expect(tables.messages[0]).toMatchObject({
      status: 'failed',
      error_code: 131049,
      error_title: 'Blocked',
      error_details: 'd',
    })
  })

  it('never touches the same wamid in another account', async () => {
    const tables = {
      messages: [message(), message({ id: 'm2', conversation_id: 'c2', account_id: 'acc-2' })],
    }
    await applyMessageStatus(fakeDb(tables), 'acc-1', status({ status: 'read' }))
    expect(tables.messages[0].status).toBe('read')
    expect(tables.messages[1].status).toBe('sent')
  })

  it('parks a status whose message row does not exist yet', async () => {
    const tables: Record<string, Row[]> = { messages: [] }
    const advanced = await applyMessageStatus(fakeDb(tables), 'acc-1', status({ status: 'failed' }))
    expect(advanced).toEqual([])
    expect(tables.pending_message_statuses).toEqual([
      expect.objectContaining({ account_id: 'acc-1', wamid: 'wamid.1', status: 'failed' }),
    ])
  })

  it('prunes parked statuses older than a day', async () => {
    const tables: Record<string, Row[]> = {
      messages: [],
      pending_message_statuses: [
        { account_id: 'acc-1', wamid: 'wamid.old', status: 'sent', created_at: '2000-01-01T00:00:00.000Z' },
      ],
    }
    await applyMessageStatus(fakeDb(tables), 'acc-1', status())
    expect(tables.pending_message_statuses.map((r) => r.wamid)).toEqual(['wamid.1'])
  })

  it('drops statuses outside the messages CHECK constraint', async () => {
    const tables: Record<string, Row[]> = { messages: [] }
    await applyMessageStatus(fakeDb(tables), 'acc-1', status({ status: 'deleted' }))
    expect(tables.pending_message_statuses).toBeUndefined()
  })
})

describe('ack de mensagem de grupo gravada antes da normalização (24/11/2026)', () => {
  const GRUPO = '5511971415149-1593719147@g.us'
  const STANZA = 'true_' + GRUPO + '_3EB0C2C90EF17FD9D02D07'
  // Formato antigo: o quarto segmento é o participante.
  const ID_ANTIGO = STANZA + '_5516996066156@c.us'

  it('encontra a linha antiga quando o ack chega com o id normalizado', async () => {
    // Antes desta tolerância o ack não casava, a mensagem ficava presa em
    // `sent` e o status ia para `pending_message_statuses`.
    const tables = {
      messages: [message({ message_id: ID_ANTIGO })],
    }
    const advanced = await applyMessageStatus(fakeDb(tables), 'acc-1', status({ wamid: STANZA }))
    expect(advanced).toHaveLength(1)
    expect(tables.messages[0].status).toBe('delivered')
  })

  it('avança as duas linhas quando a duplicata ainda existe', async () => {
    const tables = {
      messages: [
        message({ id: 'm-send', message_id: ID_ANTIGO }),
        message({ id: 'm-eco', message_id: STANZA + '_39788627423277@lid' }),
      ],
    }
    const advanced = await applyMessageStatus(fakeDb(tables), 'acc-1', status({ wamid: STANZA }))
    expect(advanced).toHaveLength(2)
    expect(tables.messages.every((r) => r.status === 'delivered')).toBe(true)
  })

  it('NÃO faz busca por prefixo em conversa individual', async () => {
    // Individual sempre teve id estável; um prefixo ali casaria telefones
    // que só compartilham o começo.
    const tables = {
      messages: [message({ message_id: 'true_5516982594845@c.us_3EB04383E41021006D20CF_X' })],
    }
    const advanced = await applyMessageStatus(
      fakeDb(tables),
      'acc-1',
      status({ wamid: 'true_5516982594845@c.us_3EB04383E41021006D20CF' }),
    )
    expect(advanced).toEqual([])
    expect(tables.messages[0].status).toBe('sent')
  })

  it('o `_` do padrão é literal, não curinga', async () => {
    // Se o `_` do LIKE não fosse escapado, este id (mesmo prefixo, outro
    // separador) casaria por engano.
    const tables = {
      messages: [message({ message_id: STANZA + 'X_5516996066156@c.us' })],
    }
    const advanced = await applyMessageStatus(fakeDb(tables), 'acc-1', status({ wamid: STANZA }))
    expect(advanced).toEqual([])
  })
})

describe('applyPendingMessageStatuses', () => {
  it('applies a parked failure once the row is inserted, then clears it', async () => {
    const tables: Record<string, Row[]> = {
      messages: [message()],
      pending_message_statuses: [
        { account_id: 'acc-1', wamid: 'wamid.1', status: 'failed', error_code: 131026, error_title: 'Undeliverable', error_details: null },
      ],
    }
    await applyPendingMessageStatuses(fakeDb(tables), 'acc-1', 'wamid.1')
    expect(tables.messages[0]).toMatchObject({ status: 'failed', error_code: 131026 })
    expect(tables.pending_message_statuses).toEqual([])
  })

  it('folds several parked statuses forward-only', async () => {
    const tables: Record<string, Row[]> = {
      messages: [message()],
      pending_message_statuses: [
        { account_id: 'acc-1', wamid: 'wamid.1', status: 'read', error_code: null },
        { account_id: 'acc-1', wamid: 'wamid.1', status: 'delivered', error_code: null },
      ],
    }
    await applyPendingMessageStatuses(fakeDb(tables), 'acc-1', 'wamid.1')
    expect(tables.messages[0].status).toBe('read')
  })

  it('leaves another account’s parked status alone', async () => {
    const tables: Record<string, Row[]> = {
      messages: [message()],
      pending_message_statuses: [{ account_id: 'acc-2', wamid: 'wamid.1', status: 'read', error_code: null }],
    }
    await applyPendingMessageStatuses(fakeDb(tables), 'acc-1', 'wamid.1')
    expect(tables.messages[0].status).toBe('sent')
    expect(tables.pending_message_statuses).toHaveLength(1)
  })
})
