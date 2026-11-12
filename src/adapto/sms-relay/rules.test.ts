import { describe, expect, it } from 'vitest';

import {
  formatSmsRelayMessage,
  selfChatId,
  shouldForwardSms,
} from './rules';

// ============================================================
// Corpos reais, copiados dos SMS recebidos (screenshot do aparelho).
// O remetente é "9150000", mas ele VARIA — por isso não entra nos testes
// como critério.
// ============================================================

const REAL_BODIES = [
  'Seu codigo de validacao Amplimed e: 308911',
  'Seu codigo de validacao Amplimed e: 337626',
  'Seu codigo de validacao Amplimed e: 392367',
  'Seu codigo de validacao Amplimed e: 667862',
  'Seu codigo de validacao Amplimed e: 812560',
  'Seu codigo de validacao Amplimed e: 828171',
];

describe('shouldForwardSms', () => {
  it('reconhece todos os corpos reais e extrai o código', () => {
    for (const body of REAL_BODIES) {
      const decision = shouldForwardSms(body);
      expect(decision.forward).toBe(true);
      expect(decision.reason).toBe('match');
      expect(decision.code).toMatch(/^\d{6}$/);
    }
  });

  it('é case-insensitive (gateways variam a caixa)', () => {
    expect(shouldForwardSms('SEU CODIGO DE VALIDACAO AMPLIMED E: 123456').forward).toBe(true);
    expect(shouldForwardSms('Seu Código De Validação Amplimed e: 123456').forward).toBe(false);
    // Com acento não casa: o SMS real chega sem acento. Se um dia a
    // Amplimed acentuar, o teste acima falha e o prefixo é ajustado —
    // melhor um falso negativo visível do que encaminhar SMS alheio.
  });

  it('rejeita SMS que não são da Amplimed', () => {
    // O critério é o corpo, nunca o remetente: estes exemplificam o que
    // chega de banco, transportadora e contato pessoal.
    for (const body of [
      'Seu saldo e de R$ 1.234,56. Banco Exemplo',
      'Sua encomenda foi entregue. Correios',
      'Oi tudo bem? (mensagem da familia)',
      'Seu codigo de validacao OutraPlataforma e: 123456',
      '',
      null,
      undefined,
      '   ',
    ]) {
      expect(shouldForwardSms(body as string)).toEqual({
        forward: false,
        code: null,
        reason: 'no-match',
      });
    }
  });

  it('encaminha SMS da Amplimed mesmo sem código extraível', () => {
    // Casou no prefixo mas o formato do código variou: perder a mensagem
    // é pior que recebê-la inteira.
    const decision = shouldForwardSms('Seu codigo de validacao Amplimed e:');
    expect(decision).toEqual({ forward: true, code: null, reason: 'no-code' });
  });

  it('extrai código de 4 a 8 dígitos (tolerância a mudança de formato)', () => {
    expect(shouldForwardSms('Seu codigo de validacao Amplimed e: 1234').code).toBe('1234');
    expect(shouldForwardSms('Seu codigo de validacao Amplimed e: 12345678').code).toBe('12345678');
  });

  it('não deixa um número maior vazar como código', () => {
    // "e: 1234567890" — 10 dígitos não é um código 2FA.
    expect(shouldForwardSms('Seu codigo de validacao Amplimed e: 1234567890').code).toBeNull();
  });

  it('ignora texto antes do prefixo', () => {
    // "Lembrete: seu codigo..." pode ser qualquer coisa; a porta é estreita.
    expect(shouldForwardSms('Lembrete: Seu codigo de validacao Amplimed e: 123456').forward).toBe(false);
  });
});

describe('formatSmsRelayMessage', () => {
  it('destaca o código numa linha própria', () => {
    const out = formatSmsRelayMessage(REAL_BODIES[0], '308911', new Date('2026-11-11T12:01:00-03:00'));
    expect(out).toContain('*Código Amplimed: 308911*');
    expect(out).toContain(REAL_BODIES[0]);
    expect(out).toContain('Recebido às');
  });

  // Regressão do relato: o horário aparecia em UTC (13:29) quando o
  // relógio do operador marcava 10:29. O servidor roda em UTC dentro do
  // Docker; o carimbo precisa de America/Sao_Paulo explícito.
  it('carimba o horário no fuso de São Paulo, não no do servidor', () => {
    // 14:29 UTC = 11:29 em São Paulo (UTC-3).
    const out = formatSmsRelayMessage(REAL_BODIES[0], '308911', new Date('2026-11-11T14:29:00Z'));
    expect(out).toContain('Recebido às 11/11, 11:29');
    expect(out).not.toContain('14:29');
  });

  it('sem código, usa o cabeçalho genérico', () => {
    const out = formatSmsRelayMessage('Seu codigo de validacao Amplimed e:', null);
    expect(out).toContain('SMS da Amplimed');
    expect(out).not.toContain('Código Amplimed');
  });
});

describe('selfChatId', () => {
  it('monta o chat de mensagem-para-mim-mesmo', () => {
    expect(selfChatId('5551900000001')).toBe('5551900000001@c.us');
    // Tolerante a formatos com máscara ou sufixo.
    expect(selfChatId('+55 (51) 90000-0002')).toBe('5551900000002@c.us');
    expect(selfChatId('5551900000003@c.us')).toBe('5551900000003@c.us');
  });
});
