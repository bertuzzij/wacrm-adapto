import { describe, expect, it } from 'vitest';

import {
  memberPhone,
  mentionedPhones,
  mentionJid,
  mentionToken,
  toGroupMembers,
} from './members';

describe('memberPhone', () => {
  it('usa PhoneNumber quando presente', () => {
    expect(
      memberPhone({
        JID: '39788627423277@lid',
        PhoneNumber: '5511000000001@s.whatsapp.net',
      })
    ).toBe('5511000000001');
  });

  it('aceita JID quando ele já é telefone', () => {
    expect(memberPhone({ JID: '5511000000003@c.us' })).toBe('5511000000003');
  });

  it('recusa JID @lid sem PhoneNumber', () => {
    // `@lid` é identificador opaco, não telefone. Mencionar com ele
    // produziria um `@` que não existe.
    expect(memberPhone({ JID: '39788627423277@lid' })).toBe('');
  });

  it('recusa número fora do tamanho E.164', () => {
    expect(memberPhone({ PhoneNumber: '123@s.whatsapp.net' })).toBe('');
    expect(memberPhone({ PhoneNumber: '1234567890123456@s.whatsapp.net' })).toBe('');
  });

  it('tolera participante vazio', () => {
    expect(memberPhone({})).toBe('');
  });
});

describe('toGroupMembers', () => {
  const participants = [
    { JID: '1@lid', PhoneNumber: '5511000000001@s.whatsapp.net', DisplayName: 'Atendente A' },
    { JID: '2@lid', PhoneNumber: '5511000000002@s.whatsapp.net', DisplayName: '' },
    { JID: '3@lid', PhoneNumber: '5511000000003@s.whatsapp.net', DisplayName: 'Atendente B', IsAdmin: true },
    { JID: '4@lid' }, // sem telefone: fica de fora
    { JID: '5@lid', PhoneNumber: '5511000000001@s.whatsapp.net', DisplayName: 'Duplicado' },
  ];

  it('descarta quem não tem telefone mencionável', () => {
    const members = toGroupMembers(participants);
    expect(members.map((m) => m.phone)).not.toContain('');
    expect(members).toHaveLength(3);
  });

  it('deduplica por telefone', () => {
    const members = toGroupMembers(participants);
    expect(members.filter((m) => m.phone === '5511000000001')).toHaveLength(1);
  });

  it('ordena por nome e joga sem-nome para o fim', () => {
    const members = toGroupMembers(participants);
    expect(members.map((m) => m.name || m.phone)).toEqual([
      'Atendente A',
      'Atendente B',
      '5511000000002',
    ]);
  });

  it('marca administrador', () => {
    const admin = toGroupMembers(participants).find((m) => m.phone === '5511000000003');
    expect(admin?.isAdmin).toBe(true);
  });

  it('trata IsSuperAdmin como admin', () => {
    const members = toGroupMembers([
      { JID: '1@lid', PhoneNumber: '5511000000004@s.whatsapp.net', IsSuperAdmin: true },
    ]);
    expect(members[0].isAdmin).toBe(true);
  });

  it('devolve lista vazia sem participantes', () => {
    expect(toGroupMembers(null)).toEqual([]);
    expect(toGroupMembers(undefined)).toEqual([]);
    expect(toGroupMembers([])).toEqual([]);
  });
});

describe('mentionToken e mentionJid', () => {
  it('monta o marcador de texto e o JID', () => {
    expect(mentionToken('5511000000002')).toBe('@5511000000002');
    expect(mentionJid('5511000000002')).toBe('5511000000002@c.us');
  });
});

describe('mentionedPhones', () => {
  const members = [
    { phone: '5511000000002', name: 'Atendente C', isAdmin: false },
    { phone: '5511000000003', name: 'Atendente B', isAdmin: false },
  ];

  it('encontra a menção presente no texto', () => {
    expect(mentionedPhones('@5511000000002 favor ver isso', members)).toEqual([
      '5511000000002',
    ]);
  });

  it('encontra várias menções', () => {
    expect(
      mentionedPhones('@5511000000002 e @5511000000003, por favor', members)
    ).toEqual(['5511000000002', '5511000000003']);
  });

  it('não casa quando o telefone é prefixo de outro número', () => {
    // `@55110000000021` não é a menção do `5511000000002`.
    expect(mentionedPhones('@55110000000021', members)).toEqual([]);
  });

  it('não casa texto sem @', () => {
    expect(mentionedPhones('5511000000002', members)).toEqual([]);
  });

  it('ignora menção a quem não é membro', () => {
    expect(mentionedPhones('@5511000000000 olha', members)).toEqual([]);
  });
});
