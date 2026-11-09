import { describe, expect, it } from 'vitest';

import {
  authorNameFrom,
  authorWaIdFrom,
  messageAuthorFrom,
  phoneFromJid,
} from './author';

// ============================================================
// Payload real de produção, reduzido ao que este módulo lê.
// Veio de uma mensagem do grupo "Conteúdo Amplimed" (120363…@g.us).
// ============================================================
const REAL_GROUP_MESSAGE = {
  from: '120363428761761505@g.us',
  participant: '25229342556178@lid',
  _data: {
    Info: {
      Chat: '120363428761761505@g.us',
      Sender: '25229342556178@lid',
      IsGroup: true,
      SenderAlt: '555190000001@s.whatsapp.net',
      PushName: 'Marketing Amplimed',
    },
  },
};

describe('phoneFromJid', () => {
  it('extrai o telefone de um JID de usuário', () => {
    expect(phoneFromJid('555190000001@s.whatsapp.net')).toBe('555190000001');
    expect(phoneFromJid('555190000002@c.us')).toBe('555190000002');
  });

  it('recusa LID, grupo, canal e status', () => {
    // Um LID (`…@lid`) é opaco: converter em dígitos criaria um telefone
    // que não existe. Foi exatamente esse tipo de conversão que gerou
    // números falsos para grupos (ver identity.ts).
    expect(phoneFromJid('25229342556178@lid')).toBeNull();
    expect(phoneFromJid('120363428761761505@g.us')).toBeNull();
    expect(phoneFromJid('123@newsletter')).toBeNull();
    expect(phoneFromJid('status@broadcast')).toBeNull();
  });

  it('recusa comprimentos impossíveis', () => {
    expect(phoneFromJid('123@s.whatsapp.net')).toBeNull();
    expect(phoneFromJid('1234567890123456@s.whatsapp.net')).toBeNull();
  });

  it('devolve null para entrada vazia', () => {
    expect(phoneFromJid(null)).toBeNull();
    expect(phoneFromJid(undefined)).toBeNull();
    expect(phoneFromJid('')).toBeNull();
    expect(phoneFromJid('   ')).toBeNull();
  });
});

describe('authorNameFrom', () => {
  it('prefere o PushName, que é o que o WhatsApp mostra', () => {
    expect(authorNameFrom(REAL_GROUP_MESSAGE)).toBe('Marketing Amplimed');
  });

  it('cai para notifyName quando o PushName falta', () => {
    expect(
      authorNameFrom({ _data: { notifyName: 'Fulano' } })
    ).toBe('Fulano');
  });

  it('devolve null quando não há nome nenhum', () => {
    expect(authorNameFrom({})).toBeNull();
    expect(authorNameFrom({ _data: {} })).toBeNull();
  });

  it('ignora nomes só com espaço', () => {
    expect(authorNameFrom({ _data: { pushName: '   ' } })).toBeNull();
  });
});

describe('authorWaIdFrom', () => {
  it('usa o participant do topo, que é o campo canônico', () => {
    expect(authorWaIdFrom(REAL_GROUP_MESSAGE)).toBe('25229342556178@lid');
  });

  it('cai para Info.Sender quando participant falta', () => {
    expect(
      authorWaIdFrom({ _data: { Info: { Sender: '555190000003@c.us' } } })
    ).toBe('555190000003@c.us');
  });

  it('devolve null sem identificador', () => {
    expect(authorWaIdFrom({})).toBeNull();
  });
});

describe('messageAuthorFrom', () => {
  it('monta o autor completo a partir do payload real', () => {
    expect(messageAuthorFrom(REAL_GROUP_MESSAGE, { isGroup: true })).toEqual({
      name: 'Marketing Amplimed',
      waId: '25229342556178@lid',
      phone: '555190000001',
    });
  });

  // Regressão do relato: mensagem de grupo precisa trazer quem enviou.
  it('traz nome e telefone de um membro externo', () => {
    const author = messageAuthorFrom(REAL_GROUP_MESSAGE, { isGroup: true });
    expect(author?.name).toBe('Marketing Amplimed');
    expect(author?.phone).toBe('555190000001');
  });

  it('devolve null fora de grupo (conversa individual não tem autor distinto)', () => {
    expect(messageAuthorFrom(REAL_GROUP_MESSAGE, { isGroup: false })).toBeNull();
  });

  it('devolve null quando o payload não traz nada de autor', () => {
    expect(
      messageAuthorFrom({ from: '120363428761761505@g.us' }, { isGroup: true })
    ).toBeNull();
  });

  it('ainda devolve autor quando só o identificador existe', () => {
    // Grupo com membro que nunca publicou nome: sem PushName, mas o LID
    // continua identificando a pessoa entre mensagens.
    const author = messageAuthorFrom(
      { participant: '25229342556178@lid' },
      { isGroup: true }
    );
    expect(author).toEqual({
      name: null,
      waId: '25229342556178@lid',
      phone: null,
    });
  });

  it('não vaza telefone falso quando o SenderAlt é LID', () => {
    const author = messageAuthorFrom(
      {
        participant: '25229342556178@lid',
        _data: { Info: { PushName: 'X', SenderAlt: '25229342556178@lid' } },
      },
      { isGroup: true }
    );
    expect(author?.phone).toBeNull();
  });
});
