import { describe, expect, it } from 'vitest';
import {
  applyCrmContact,
  loadCrmContactDirectory,
} from './crm-directory';

/**
 * Enriquecimento da lista de menções com os contatos do CRM.
 *
 * Contexto: a lista vinha direto do WAHA, que não entrega nome — o payload
 * de grupos traz `DisplayName: ""`. O resultado era número puro na tela,
 * sem foto, mesmo com 29 contatos nomeados e com foto no banco.
 */

/** Falso Supabase: devolve `data` fixo para a consulta de contatos. */
function fakeDb(
  rows: Array<{ phone?: string; name?: string; avatar_url?: string }>,
  error: { message: string } | null = null,
) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          not: () => ({
            not: () => Promise.resolve({ data: rows, error }),
          }),
        }),
      }),
    }),
  } as never;
}

describe('loadCrmContactDirectory', () => {
  it('indexa por telefone em dígitos', async () => {
    const crm = await loadCrmContactDirectory(
      fakeDb([{ phone: '5516992722522@c.us', name: 'Clínica Dr. Alexandre' }]),
      'acc-1',
    );
    // O `@c.us` sai: a chave é o telefone puro, que é como o membro chega.
    expect(crm.get('5516992722522')?.name).toBe('Clínica Dr. Alexandre');
  });

  it('mantém o cache-busting da foto (?v=...)', async () => {
    const url = 'https://x.supabase.co/storage/v1/object/public/contact-avatars/a.jpg?v=1731000000000';
    const crm = await loadCrmContactDirectory(
      fakeDb([{ phone: '5511', name: 'Alguém', avatar_url: url }]),
      'acc-1',
    );
    expect(crm.get('5511')?.avatarUrl).toBe(url);
  });

  it('descarta contato de grupo (não é pessoa)', async () => {
    const crm = await loadCrmContactDirectory(
      fakeDb([{ phone: 'group:5511971415149-1593719147@g.us', name: 'Grupo X' }]),
      'acc-1',
    );
    // O filtro `.not('phone', 'like', 'group:%')` roda no banco; o fake
    // não filtra, então o mapa fica vazio por não ter telefone útil.
    expect(crm.size).toBe(0);
  });

  it('não agrega entrada sem nome e sem foto', async () => {
    const crm = await loadCrmContactDirectory(
      fakeDb([{ phone: '5511' }]),
      'acc-1',
    );
    expect(crm.size).toBe(0);
  });

  it('devolve mapa vazio em erro de consulta (não lança)', async () => {
    const crm = await loadCrmContactDirectory(
      fakeDb([], { message: 'boom' }),
      'acc-1',
    );
    expect(crm.size).toBe(0);
  });
});

describe('applyCrmContact', () => {
  const member = {
    phone: '5516992722522',
    name: '',
    avatarUrl: null as string | null,
  };

  it('preenche nome e foto a partir do CRM', () => {
    const crm = new Map([
      ['5516992722522', { name: 'Clínica Dr. Alexandre', avatarUrl: 'https://x/foto.jpg' }],
    ]);
    applyCrmContact(member, crm);
    expect(member.name).toBe('Clínica Dr. Alexandre');
    expect(member.avatarUrl).toBe('https://x/foto.jpg');
  });

  it('o nome do CRM VENCE o pushname do WhatsApp', () => {
    const m = { phone: '5511', name: 'pushname do contato', avatarUrl: null };
    applyCrmContact(m, new Map([['5511', { name: 'Nome salvo pelo atendente', avatarUrl: null }]]));
    // Deliberado: o atendente cadastrou o nome que reconhece.
    expect(m.name).toBe('Nome salvo pelo atendente');
  });

  it('não apaga nome existente quando o CRM não tem nome para ele', () => {
    const m = { phone: '5511', name: 'pushname', avatarUrl: null };
    applyCrmContact(m, new Map([['5511', { name: '', avatarUrl: 'https://x/f.jpg' }]]));
    expect(m.name).toBe('pushname');
    expect(m.avatarUrl).toBe('https://x/f.jpg');
  });

  it('membro sem telefone não é enriquecido (não há chave de busca)', () => {
    const m = { phone: '', name: '', avatarUrl: null };
    applyCrmContact(m, new Map([['5511', { name: 'X', avatarUrl: null }]]));
    expect(m.name).toBe('');
  });

  it('membro que não está no CRM passa intocado', () => {
    const m = { phone: '5599', name: 'Do WAHA', avatarUrl: null };
    applyCrmContact(m, new Map([['5511', { name: 'Outro', avatarUrl: null }]]));
    expect(m.name).toBe('Do WAHA');
    expect(m.avatarUrl).toBeNull();
  });

  it('mapa indefinido é inofensivo', () => {
    const m = { phone: '5511', name: 'Original', avatarUrl: null };
    applyCrmContact(m, undefined);
    expect(m.name).toBe('Original');
  });
});
