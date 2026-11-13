import { describe, expect, it } from 'vitest';

import { isValidEmail, validatePassword } from './rules';

describe('validatePassword', () => {
  it('aceita senha com 6+ caracteres e confirmação igual', () => {
    expect(validatePassword('abc123', 'abc123')).toEqual({ ok: true, error: null });
    expect(validatePassword(' abc123xyz ', ' abc123xyz ')).toEqual({ ok: true, error: null });
  });

  it('recusa abaixo do piso de 6 (mesmo do /signup)', () => {
    expect(validatePassword('abc12', 'abc12')).toEqual({
      ok: false,
      error: 'too-short',
    });
  });

  it('recusa vazia', () => {
    expect(validatePassword('', '')).toEqual({ ok: false, error: 'empty' });
  });

  it('recusa confirmação diferente', () => {
    expect(validatePassword('abc123', 'abc124')).toEqual({
      ok: false,
      error: 'mismatch',
    });
  });

  it('sem confirmação, valida só a senha', () => {
    expect(validatePassword('abc123')).toEqual({ ok: true, error: null });
  });
});

describe('isValidEmail', () => {
  it('aceita emails plausíveis da base real', () => {
    expect(isValidEmail('cristiane.vieira@exemplo.com.br')).toBe(true);
    expect(isValidEmail('suporte@exemplo.com')).toBe(true);
  });

  it('recusa lixo estrutural', () => {
    expect(isValidEmail('sem-arroba')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});
