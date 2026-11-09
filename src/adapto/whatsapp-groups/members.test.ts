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
    { JID: '4@lid' }, // sem telefone: continua na lista, mas não mencionável
    { JID: '5@lid', PhoneNumber: '5511000000001@s.whatsapp.net', DisplayName: 'Duplicado' },
  ];

  it('mantém quem não tem telefone, mas com phone vazio', () => {
    // Antes eram descartados em silêncio. No grupo medido isso excluía 148
    // de 150 pessoas — a lista parecia "quase vazia" mesmo com o grupo
    // cheio. Saber quem está no grupo é útil; mencionar é que exige número.
    const members = toGroupMembers(participants);
    expect(members).toHaveLength(4);
    expect(members.filter((m) => m.phone === '')).toHaveLength(1);
  });

  it('deduplica por telefone', () => {
    const members = toGroupMembers(participants);
    expect(members.filter((m) => m.phone === '5511000000001')).toHaveLength(1);
  });

  it('ordena por nome e joga sem-nome para o fim', () => {
    const members = toGroupMembers(participants);
    // 'Atendente A' e 'Atendente B' primeiro; o resto (sem nome) depois.
    expect(members.slice(0, 2).map((m) => m.name)).toEqual([
      'Atendente A',
      'Atendente B',
    ]);
    expect(members.slice(2).every((m) => m.name === '')).toBe(true);
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

describe('toGroupMembers com nome resolvido pelo diretório', () => {
  const participants = [
    { JID: '1@lid', PhoneNumber: '5511000000001@s.whatsapp.net', DisplayName: '' },
    { JID: '2@lid', PhoneNumber: '5511000000002@s.whatsapp.net', DisplayName: '' },
  ];

  it('usa o nome do diretório quando DisplayName vem vazio', () => {
    // O endpoint de grupos não traz nome útil; o real vem do diretório de
    // contatos, indexado pelo identificador. Este é o caso normal.
    const directory = new Map([['1@lid', 'Atendente A']]);
    const members = toGroupMembers(participants, directory);

    expect(members.find((m) => m.phone === '5511000000001')?.name).toBe('Atendente A');
  });

  // Regressão do relato de lentidão: o diretório é indexado por LID, que é
  // o identificador que os participantes de grupo realmente têm.
  it('resolve pelo LID quando o participante não tem telefone', () => {
    const members = toGroupMembers(
      [{ JID: '114869655363689@lid', PhoneNumber: '', DisplayName: '+55∙∙∙∙∙∙∙∙11' }],
      new Map([['114869655363689@lid', 'Marketing Amplimed']])
    );
    expect(members[0].name).toBe('Marketing Amplimed');
    expect(members[0].phone).toBe('');
  });

  // Regressão: DisplayName do WAHA é o telefone MASCARADO, não um nome.
  // Usá-lo enchia a lista de "+55∙∙∙∙∙∙∙∙11".
  it('não usa DisplayName mascarado como nome', () => {
    const members = toGroupMembers([
      { JID: '1@lid', PhoneNumber: '', DisplayName: '+55∙∙∙∙∙∙∙∙11' },
    ]);
    expect(members[0].name).toBe('');
  });

  it('mantém avatarUrl null (foto por membro sairia caro)', () => {
    const members = toGroupMembers(participants, new Map());
    expect(members.every((m) => m.avatarUrl === null)).toBe(true);
  });

  it('não descarta membro sem telefone', () => {
    // Antes, quem não tinha telefone era removido em silêncio — e no grupo
    // medido isso era 148 de 150 pessoas. Saber quem está no grupo é útil,
    // mesmo sem poder mencionar por número.
    const members = toGroupMembers([
      { JID: '1@lid', PhoneNumber: '', DisplayName: '' },
      { JID: '2@lid', PhoneNumber: '5511000000002@s.whatsapp.net', DisplayName: '' },
    ]);
    expect(members).toHaveLength(2);
  });

  it('expõe o waId de cada membro', () => {
    const members = toGroupMembers(participants, new Map());
    expect(members.map((m) => m.waId).sort()).toEqual(['1@lid', '2@lid']);
  });

  it('ordena por nome, quem não tem nome vai para o fim', () => {
    const directory = new Map([
      ['1@lid', 'Zulu'],
      ['2@lid', 'Alfa'],
    ]);
    const members = toGroupMembers(participants, directory);
    expect(members.map((m) => m.name)).toEqual(['Alfa', 'Zulu']);
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
    { phone: '5511000000002', waId: 'b@lid', name: 'Atendente C', avatarUrl: null, isAdmin: false },
    { phone: '5511000000003', waId: 'c@lid', name: 'Atendente B', avatarUrl: null, isAdmin: false },
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

  it('ignora membro sem telefone (LID não é mencionável por texto)', () => {
    const semTelefone = [
      { phone: '', waId: '1@lid', name: 'Só LID', avatarUrl: null, isAdmin: false },
    ];
    expect(mentionedPhones('@1 olha', semTelefone)).toEqual([]);
  });
});
