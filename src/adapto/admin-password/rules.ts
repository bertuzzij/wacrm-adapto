// ============================================================
// Regras de senha para o resgate administrativo.
//
// Mesmo piso do /signup e do /reset-password (6 caracteres) — as três
// portas de escrita de senha do produto não podem divergir.
// Módulo puro: a rota e a UI validam com o mesmo código, sem drift.
// ============================================================

/** Piso compartilhado com /signup e /reset-password. */
export const MIN_PASSWORD_LENGTH = 6;

export interface PasswordCheck {
  ok: boolean;
  error: 'too-short' | 'empty' | 'mismatch' | null;
}

export function validatePassword(
  password: string,
  confirm?: string
): PasswordCheck {
  if (!password) return { ok: false, error: 'empty' };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: 'too-short' };
  }
  if (confirm !== undefined && confirm !== password) {
    return { ok: false, error: 'mismatch' };
  }
  return { ok: true, error: null };
}

/**
 * Email em formato plausível. O lookup é por email (o owner não tem o
 * user_id à mão), e uma validação estrutural evita custar uma consulta
 * ao banco por lixo digitado.
 */
export function isValidEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim());
}
