import { describe, expect, it } from 'vitest';

import { canOverwriteName, chatIdFor, extFor, resolveName } from './rules';

describe('chatIdFor', () => {
  it('prefere o wa_user_id (líder do WhatsApp novo) ao telefone', () => {
    // O @lid é o identificador que os endpoints de chat resolvem de forma
    // confiável; o telefone pode não existir para contatos com BSUID.
    expect(
      chatIdFor({ wa_user_id: '102864600985653', phone: '5551990000001' }),
    ).toBe('102864600985653@lid');
  });

  it('mantém o @lid quando ele já vem com o sufixo', () => {
    expect(chatIdFor({ wa_user_id: '102864600985653@lid' })).toBe(
      '102864600985653@lid',
    );
  });

  it('usa o telefone quando não há wa_user_id', () => {
    expect(chatIdFor({ phone: '5551990000001' })).toBe('5551990000001@c.us');
  });

  it('limpa a formatação do telefone', () => {
    expect(chatIdFor({ phone: '+55 51 99000-0001' })).toBe('5551990000001@c.us');
  });

  it('devolve null sem telefone e sem lid', () => {
    // Contato só com BSUID da Meta: não há como consultar no WAHA.
    expect(chatIdFor({ wa_username: 'fulano' })).toBeNull();
    expect(chatIdFor({ phone: null, wa_user_id: null })).toBeNull();
  });

  it('ignora string vazia em wa_user_id e cai para o telefone', () => {
    expect(chatIdFor({ wa_user_id: '   ', phone: '5551988887777' })).toBe(
      '5551988887777@c.us',
    );
  });
});

describe('canOverwriteName', () => {
  it('não sobrescreve nome editado por uma pessoa', () => {
    expect(canOverwriteName('manual')).toBe(false);
  });

  it('sobrescreve nome importado do WhatsApp', () => {
    expect(canOverwriteName('whatsapp')).toBe(true);
  });

  it('sobrescreve quando nunca foi sincronizado (NULL)', () => {
    expect(canOverwriteName(null)).toBe(true);
    expect(canOverwriteName(undefined)).toBe(true);
  });
});

describe('resolveName', () => {
  it('importa o nome da agenda quando o contato ainda não tem nome', () => {
    expect(
      resolveName({ currentName: null, currentSource: null, whatsappName: 'Aline Ferro' }),
    ).toEqual({ name: 'Aline Ferro', source: 'whatsapp' });
  });

  it('atualiza um nome que veio do WhatsApp', () => {
    expect(
      resolveName({
        currentName: 'Aline',
        currentSource: 'whatsapp',
        whatsappName: 'Aline Ferro',
      }),
    ).toEqual({ name: 'Aline Ferro', source: 'whatsapp' });
  });

  it('PRESERVA o nome digitado à mão — o caso que justifica a coluna', () => {
    // Sem name_source este teste seria impossível: a string "Aline" não diz
    // se foi importada ou digitada.
    expect(
      resolveName({
        currentName: 'Cliente VIP - Aline',
        currentSource: 'manual',
        whatsappName: 'Aline Ferro',
      }),
    ).toBeNull();
  });

  it('não grava nada quando o nome é idêntico (evita UPDATE desnecessário)', () => {
    expect(
      resolveName({
        currentName: 'Aline Ferro',
        currentSource: 'whatsapp',
        whatsappName: 'Aline Ferro',
      }),
    ).toBeNull();
  });

  it('não grava quando o WhatsApp não tem nome', () => {
    expect(
      resolveName({ currentName: 'Aline', currentSource: null, whatsappName: null }),
    ).toBeNull();
  });

  it('não grava nome em branco', () => {
    expect(
      resolveName({ currentName: null, currentSource: null, whatsappName: '   ' }),
    ).toBeNull();
  });

  it('apara espaços do nome importado', () => {
    expect(
      resolveName({ currentName: null, currentSource: null, whatsappName: '  Aline  ' }),
    ).toEqual({ name: 'Aline', source: 'whatsapp' });
  });
});

describe('extFor', () => {
  it('mapeia os formatos que o bucket aceita', () => {
    expect(extFor('image/jpeg')).toBe('jpg');
    expect(extFor('image/png')).toBe('png');
    expect(extFor('image/webp')).toBe('webp');
    expect(extFor('image/gif')).toBe('gif');
  });

  it('cai para jpg em tipo desconhecido, com parâmetro de charset', () => {
    expect(extFor('image/jpeg; charset=binary')).toBe('jpg');
    expect(extFor('application/octet-stream')).toBe('jpg');
  });
});
