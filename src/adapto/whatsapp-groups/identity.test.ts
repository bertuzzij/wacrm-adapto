import { describe, expect, it } from 'vitest';

import {
  conversationKindFor,
  groupChatIdFromPhoneKey,
  groupDisplayName,
  groupPhoneKey,
  isGroupChatId,
  isGroupPhoneKey,
} from './identity';

/** Um id real, no formato que o WAHA entrega. */
const GROUP_ID = '5511000000001-1000000001@g.us';
const DIRECT_ID = '5511000000003@c.us';

describe('isGroupChatId', () => {
  it('reconhece id de grupo', () => {
    expect(isGroupChatId(GROUP_ID)).toBe(true);
  });

  it('não confunde conversa individual com grupo', () => {
    expect(isGroupChatId(DIRECT_ID)).toBe(false);
  });

  it('ignora status e newsletter (não são grupo)', () => {
    expect(isGroupChatId('status@broadcast')).toBe(false);
    expect(isGroupChatId('123@newsletter')).toBe(false);
  });

  it('tolera nulo e vazio', () => {
    expect(isGroupChatId(null)).toBe(false);
    expect(isGroupChatId(undefined)).toBe(false);
    expect(isGroupChatId('')).toBe(false);
  });

  it('tolera espaço em volta', () => {
    expect(isGroupChatId(`  ${GROUP_ID}  `)).toBe(true);
  });
});

describe('groupPhoneKey', () => {
  it('prefixa com group:', () => {
    expect(groupPhoneKey(GROUP_ID)).toBe(`group:${GROUP_ID}`);
  });

  it('é idempotente — não vira group:group:', () => {
    // A mesma conversa pode ser resolvida duas vezes no mesmo evento.
    const once = groupPhoneKey(GROUP_ID);
    expect(groupPhoneKey(once)).toBe(once);
  });

  it('nunca é numérico, então não colide com telefone de pessoa', () => {
    // `contacts.phone` é NOT NULL e único por conta (migração 022). A
    // chave de grupo precisa ser reconhecivelmente NÃO-telefone: é isso
    // que impede um grupo de disputar o índice com uma pessoa.
    const key = groupPhoneKey(GROUP_ID);
    expect(key.startsWith('group:')).toBe(true);
    expect(/^\d+$/.test(key)).toBe(false);
    expect(/^\+\d+$/.test(key)).toBe(false);
  });

  it('grupos diferentes geram chaves diferentes', () => {
    const other = '5511000000002-1000000002@g.us';
    expect(groupPhoneKey(GROUP_ID)).not.toBe(groupPhoneKey(other));
  });
});

describe('isGroupPhoneKey', () => {
  it('reconhece a chave de grupo', () => {
    expect(isGroupPhoneKey(groupPhoneKey(GROUP_ID))).toBe(true);
  });

  it('não reconhece telefone de pessoa', () => {
    expect(isGroupPhoneKey('5511000000003')).toBe(false);
    expect(isGroupPhoneKey('')).toBe(false);
    expect(isGroupPhoneKey(null)).toBe(false);
  });
});

describe('groupChatIdFromPhoneKey', () => {
  it('volta ao id original', () => {
    expect(groupChatIdFromPhoneKey(groupPhoneKey(GROUP_ID))).toBe(GROUP_ID);
  });

  it('devolve null para valor que não é de grupo', () => {
    expect(groupChatIdFromPhoneKey('5511000000003')).toBeNull();
    expect(groupChatIdFromPhoneKey('group:')).toBeNull();
    expect(groupChatIdFromPhoneKey(null)).toBeNull();
  });
});

describe('groupDisplayName', () => {
  it('usa o nome do grupo quando existe', () => {
    expect(groupDisplayName('Soluti-Unimed São Carlos')).toBe('Soluti-Unimed São Carlos');
  });

  it('cai no rótulo neutro quando falta nome', () => {
    expect(groupDisplayName('')).toBe('(grupo sem nome)');
    expect(groupDisplayName(null)).toBe('(grupo sem nome)');
    expect(groupDisplayName('   ')).toBe('(grupo sem nome)');
  });

  it('aceita rótulo traduzido', () => {
    expect(groupDisplayName('', 'Grupo')).toBe('Grupo');
  });
});

describe('conversationKindFor', () => {
  it('classifica grupo e individual', () => {
    expect(conversationKindFor(GROUP_ID)).toBe('group');
    expect(conversationKindFor(DIRECT_ID)).toBe('direct');
    expect(conversationKindFor(null)).toBe('direct');
  });
});
