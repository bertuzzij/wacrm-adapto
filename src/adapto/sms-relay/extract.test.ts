import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================
// Testes da extração recursiva — reproduzem os payloads REAIS que os apps
// mandaram durante a depuração, incluindo os que falharam.
// ============================================================

// Import direto da rota não é possível (é um route handler com runtime de
// servidor), então a função é testada pela sua especificação: mesmo
// contrato, mesmas regras. O teste estrutural abaixo garante que a rota
// usa esta função.
import { shouldForwardSms } from '@/adapto/sms-relay/rules';

/** Réplica fiel da lógica de extração da rota, para testar em isolamento. */
function extractSmsText(value: unknown, depth = 0): string | null {
  if (depth > 6) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && shouldForwardSms(trimmed).forward) return trimmed;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractSmsText(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const SKIP = new Set(['token', 'secret', 'authorization', 'password', 'apikey', 'api_key']);
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => {
      const texty = (k: string) =>
        ['message', 'body', 'text', 'msg', 'content'].includes(k.toLowerCase()) ? 0 : 1;
      return texty(a) - texty(b);
    });
    for (const [key, child] of entries) {
      if (SKIP.has(key.toLowerCase())) continue;
      const found = extractSmsText(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

const REAL_SMS = 'Seu codigo de validacao Amplimed e: 452995';

describe('extractSmsText — payloads reais dos apps', () => {
  it('encontra o texto no formato canônico {"body": ...}', () => {
    expect(extractSmsText({ body: REAL_SMS })).toBe(REAL_SMS);
  });

  // O payload que o SMS Forwarder realmente manda (campos do app).
  it('encontra no JSON nativo do SMS Forwarder', () => {
    const payload = {
      from: '9150000',
      message: REAL_SMS,
      date: '2026-11-12 14:01',
      sentTime: '2026-11-12 14:01',
    };
    expect(extractSmsText(payload)).toBe(REAL_SMS);
  });

  it('prefere o campo body quando os dois existem', () => {
    const payload = {
      body: REAL_SMS,
      message: 'outro texto qualquer',
    };
    expect(extractSmsText(payload)).toBe(REAL_SMS);
  });

  it('encontra dentro de estruturas aninhadas', () => {
    const payload = {
      event: { type: 'sms', data: { text: REAL_SMS } },
    };
    expect(extractSmsText(payload)).toBe(REAL_SMS);
  });

  it('devolve null quando nada casa com o padrão', () => {
    // SMS comum: o filtro recusa, a extração não deve "fabricar" match.
    expect(extractSmsText({ body: 'Sua encomenda chegou. Correios' })).toBeNull();
    expect(extractSmsText({ message: 'From : 9150000' })).toBeNull();
  });

  it('NUNCA devolve o valor de chaves sensíveis', () => {
    // Um app mal-configurado pode incluir a própria credencial no corpo.
    // Mesmo que o valor seja uma string, estas chaves são puladas.
    const payload = {
      token: REAL_SMS,
      secret: REAL_SMS,
      authorization: REAL_SMS,
    };
    expect(extractSmsText(payload)).toBeNull();
  });

  it('recusa o placeholder LITERAL que os apps enviaram', () => {
    // Os três literais capturados nos logs durante a depuração.
    expect(extractSmsText({ body: '[sms_text]' })).toBeNull();
    expect(extractSmsText({ body: '[msg]' })).toBeNull();
    expect(extractSmsText({ body: '{sms_text}' })).toBeNull();
  });

  it('respeita a profundidade máxima (payload hostil não trava)', () => {
    let deep: unknown = REAL_SMS;
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    // Não lança; pode não achar (profundidade), mas termina.
    expect(() => extractSmsText(deep)).not.toThrow();
  });
});

describe('a rota usa a extração', () => {
  const src = readFileSync('src/app/api/adapto/sms-relay/route.ts', 'utf8');
  const live = src
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

  it('chama extractSmsText no caminho JSON', () => {
    expect(live).toContain('extractSmsText(parsed)');
  });

  it('pula chaves sensíveis na extração', () => {
    expect(live).toContain("SKIP_KEYS");
    expect(live).toContain("'token'");
  });
});
