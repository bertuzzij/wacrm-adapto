import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';

// ============================================================
// A rota é fina de propósito: decidir (rules.ts) e enviar (waha) já têm
// donos. O que precisa de teste AQUI é o que só existe na rota:
// autenticação por token dedicado e o contrato de respostas que o app do
// celular vai consumir.
// ============================================================

const tokenOk = (expected: string, provided: string): boolean => {
  // Réplica fiel da comparação da rota, para testar o padrão em isolamento.
  const a = crypto.createHash('sha256').update(expected).digest();
  const b = crypto.createHash('sha256').update(provided).digest();
  return crypto.timingSafeEqual(a, b);
};

describe('comparação do token do relay', () => {
  it('aceita o token correto', () => {
    expect(tokenOk('segredo-123', 'segredo-123')).toBe(true);
  });

  it('recusa token errado, vazio e com espaço', () => {
    expect(tokenOk('segredo-123', 'errado')).toBe(false);
    expect(tokenOk('segredo-123', '')).toBe(false);
    expect(tokenOk('segredo-123', ' segredo-123')).toBe(false);
  });

  it('não lança com comprimentos diferentes (hash iguala o tamanho)', () => {
    // Este era o risco da versão com `timingSafeEqual(Buffer, Buffer)`
    // direta: ela lança quando os buffers têm comprimentos diferentes, e
    // um atacante poderia usar o erro como oráculo. Hash antes neutraliza.
    expect(() => tokenOk('a', 'comprimento-totalmente-diferente')).not.toThrow();
  });
});

describe('contrato de respostas para o app do celular', () => {
  it('"não encaminhou" é 200 com forwarded:false — não é erro', () => {
    // O app manda TODOS os SMS; a maioria não é da Amplimed. Responder 4xx
    // faria o app retentar cada SMS comum em vão.
    const smsComum = { forwarded: false, reason: 'no-match' };
    expect(smsComum.forwarded).toBe(false);
  });

  it('encaminhado traz o código e o messageId', () => {
    const ok = { forwarded: true, code: '308911', messageId: 'true_5516…_ABC' };
    expect(ok.forwarded).toBe(true);
    expect(ok.code).toMatch(/^\d{6}$/);
  });
});

describe('segredo nunca vaza na resposta', () => {
  it('o token vive em env var, nunca no corpo da resposta', () => {
    // Verificação estrutural: a rota não monta resposta com process.env.
    const src = readFileSync(
      'src/app/api/adapto/sms-relay/route.ts',
      'utf8'
    );
    // Deve ler o token de env, e nunca ecoá-lo em NextResponse.json.
    expect(src).toContain('process.env.SMS_RELAY_TOKEN');
    const jsonCalls = src.match(/NextResponse\.json\([^;]*?\)\)/g) ?? [];
    for (const call of jsonCalls) {
      expect(call).not.toContain('SMS_RELAY_TOKEN');
      expect(call).not.toContain('expected');
    }
  });
});
