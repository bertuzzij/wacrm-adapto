import { describe, expect, it } from 'vitest';

import {
  contactIdForFromMe,
  isLid,
  phoneFromLidResponse,
} from './from-me';

describe('isLid', () => {
  it('reconhece identificador opaco', () => {
    expect(isLid('89288276484171@lid')).toBe(true);
  });

  it('não confunde telefone com LID', () => {
    expect(isLid('5511000000001@c.us')).toBe(false);
    expect(isLid(null)).toBe(false);
    expect(isLid(undefined)).toBe(false);
  });
});

describe('contactIdForFromMe', () => {
  it('usa _data.Info.Chat, que é o LID do contato', () => {
    const id = contactIdForFromMe({
      from: '89288276484171@lid',
      to: null,
      _data: {
        Info: {
          Chat: '11223344556677@lid',
          Sender: '5511000000009@s.whatsapp.net',
        },
      },
    });
    expect(id).toBe('11223344556677@lid');
  });

  it('nunca devolve o próprio número como destinatário', () => {
    // Se o WAHA só reporta o Sender, não há destinatário — gravar ali
    // colocaria a mensagem numa conversa com o próprio número.
    const id = contactIdForFromMe({
      from: '89288276484171@lid',
      _data: {
        Info: { Chat: '5511000000009@s.whatsapp.net', Sender: '5511000000009@s.whatsapp.net' },
      },
    });
    expect(id).toBeNull();
  });

  it('cai para payload.to quando Chat não serve', () => {
    const id = contactIdForFromMe({
      from: '89288276484171@lid',
      to: '11223344556677@lid',
      _data: { Info: { Sender: '5511000000009@s.whatsapp.net' } },
    });
    expect(id).toBe('11223344556677@lid');
  });

  it('cai para RecipientAlt como último recurso', () => {
    const id = contactIdForFromMe({
      from: '89288276484171@lid',
      _data: {
        Info: {
          Sender: '5511000000009@s.whatsapp.net',
          RecipientAlt: '556791646364@s.whatsapp.net',
        },
      },
    });
    expect(id).toBe('556791646364@s.whatsapp.net');
  });

  it('ignora status e newsletter', () => {
    const id = contactIdForFromMe({
      from: '89288276484171@lid',
      _data: { Info: { Chat: 'status@broadcast', Sender: '5511000000009@s.whatsapp.net' } },
    });
    expect(id).toBeNull();
  });

  it('devolve null sem nenhuma pista de destinatário', () => {
    expect(contactIdForFromMe({ from: '89288276484171@lid' })).toBeNull();
    expect(contactIdForFromMe({})).toBeNull();
  });
});

describe('phoneFromLidResponse', () => {
  it('extrai o telefone da resposta do /lids/', () => {
    // Formato confirmado contra a API real da instância.
    expect(
      phoneFromLidResponse({ lid: '89288276484171@lid', pn: '556791646364@c.us' })
    ).toBe('556791646364');
  });

  it('devolve null sem pn', () => {
    expect(phoneFromLidResponse({ lid: 'x@lid' })).toBeNull();
    expect(phoneFromLidResponse(null)).toBeNull();
    expect(phoneFromLidResponse({ pn: 123 })).toBeNull();
  });

  it('recusa pn fora do tamanho E.164', () => {
    expect(phoneFromLidResponse({ pn: '123@c.us' })).toBeNull();
    expect(phoneFromLidResponse({ pn: '1234567890123456@c.us' })).toBeNull();
  });
});
