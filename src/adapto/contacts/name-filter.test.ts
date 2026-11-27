import { describe, expect, it } from 'vitest';

import { contactInitials, isPhoneOnlyName } from './name-filter';

describe('isPhoneOnlyName', () => {
  it('identifica nomes vazios ou ausentes como sem nome real', () => {
    expect(isPhoneOnlyName(null)).toBe(true);
    expect(isPhoneOnlyName(undefined)).toBe(true);
    expect(isPhoneOnlyName('')).toBe(true);
    expect(isPhoneOnlyName('   ')).toBe(true);
  });

  it('identifica números crus e formatados como apenas número', () => {
    expect(isPhoneOnlyName('5516992535543')).toBe(true);
    expect(isPhoneOnlyName('+5516992535543')).toBe(true);
    expect(isPhoneOnlyName('+55 (16) 99253-5543')).toBe(true);
    expect(isPhoneOnlyName('  16 99253-5543  ')).toBe(true);
  });

  it('reconhece nomes reais, inclusive os que contêm dígitos', () => {
    expect(isPhoneOnlyName('Maria Silva')).toBe(false);
    expect(isPhoneOnlyName('SOLUTI')).toBe(false);
    expect(isPhoneOnlyName('Clínica 24h')).toBe(false);
    expect(isPhoneOnlyName('Dr. João 2')).toBe(false);
  });

  it('não trata pontuação sem dígito como número', () => {
    expect(isPhoneOnlyName('---')).toBe(false);
  });
});

describe('contactInitials', () => {
  it('devolve null quando não há nome real (para cair no ícone genérico)', () => {
    expect(contactInitials('5516992535543')).toBeNull();
    expect(contactInitials('+55 (16) 99253-5543')).toBeNull();
    expect(contactInitials('')).toBeNull();
    expect(contactInitials(null)).toBeNull();
  });

  it('usa primeira e última inicial para nomes compostos', () => {
    expect(contactInitials('Maria Silva')).toBe('MS');
    expect(contactInitials('Dr Carlos Fischer de Toledo')).toBe('DT');
  });

  it('usa até duas letras para nome de uma palavra', () => {
    expect(contactInitials('SOLUTI')).toBe('SO');
    expect(contactInitials('A')).toBe('A');
  });
});
