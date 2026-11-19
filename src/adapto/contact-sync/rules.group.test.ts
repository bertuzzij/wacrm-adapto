// Testes para o suporte a grupo no contact-sync (capa do grupo).
import { describe, expect, it } from 'vitest';
import { chatIdFor } from './rules';

describe('chatIdFor — grupo (capa do grupo)', () => {
  it('resolve group:<jid> para o JID do grupo', () => {
    expect(
      chatIdFor({ phone: 'group:5516997222644-1612366296@g.us' }),
    ).toBe('5516997222644-1612366296@g.us');
  });

  it('group: sem JID válido devolve null', () => {
    expect(chatIdFor({ phone: 'group:' })).toBeNull();
  });

  it('contato comum continua com @c.us', () => {
    expect(chatIdFor({ phone: '5516992722522' })).toBe('5516992722522@c.us');
  });

  it('contato com lid continua com @lid', () => {
    expect(chatIdFor({ wa_user_id: '89288276484171@lid' })).toBe(
      '89288276484171@lid',
    );
  });

  it('grupo não é confundido com telefone (dígitos de grupo não viram @c.us)', () => {
    // "5516997222644-1612366296" sem o prefixo group: seria ambíguo; com o
    // prefixo, é inequívoco.
    expect(chatIdFor({ phone: 'group:120363428761761505@g.us' })).toBe(
      '120363428761761505@g.us',
    );
  });
});
