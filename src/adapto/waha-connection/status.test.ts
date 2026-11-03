import { describe, it, expect } from 'vitest';

import {
  describeStatus,
  normalizeStatus,
  describeConflicts,
  cappingUsagePercent,
  formatPhoneFromJid,
  toEpochMs,
  WAHA_STATUSES,
} from './status';

describe('normalizeStatus', () => {
  it.each(WAHA_STATUSES)('reconhece %s', (status) => {
    expect(normalizeStatus(status)).toBe(status);
  });

  it('aceita caixa baixa e espaços (o WAHA nem sempre é consistente)', () => {
    expect(normalizeStatus(' working ')).toBe('WORKING');
    expect(normalizeStatus('scan_qr_code')).toBe('SCAN_QR_CODE');
  });

  it('cai em UNKNOWN para lixo, null e vazio', () => {
    expect(normalizeStatus('BANANA')).toBe('UNKNOWN');
    expect(normalizeStatus(null)).toBe('UNKNOWN');
    expect(normalizeStatus(undefined)).toBe('UNKNOWN');
    expect(normalizeStatus('')).toBe('UNKNOWN');
  });
});

describe('describeStatus', () => {
  it('WORKING é o único estado em que a conexão está boa', () => {
    const view = describeStatus('WORKING');
    expect(view.state).toBe('connected');
    // Nada a fazer: sem botão de reconectar, sem QR.
    expect(view.canReconnect).toBe(false);
    expect(view.canFetchQr).toBe(false);
    expect(view.hintKey).toBe('');
  });

  it('SCAN_QR_CODE pede ação e libera o QR', () => {
    const view = describeStatus('SCAN_QR_CODE');
    expect(view.state).toBe('action');
    expect(view.canFetchQr).toBe(true);
    expect(view.canReconnect).toBe(true);
    expect(view.messageKey).toBe('statusNeedsQr');
  });

  it('STARTING é só espera — não oferece reconectar nem QR', () => {
    const view = describeStatus('STARTING');
    expect(view.state).toBe('busy');
    expect(view.canFetchQr).toBe(false);
    expect(view.canReconnect).toBe(false);
  });

  it('STOPPED e FAILED são queda e permitem reconectar', () => {
    for (const status of ['STOPPED', 'FAILED'] as const) {
      const view = describeStatus(status);
      expect(view.state).toBe('down');
      expect(view.canReconnect).toBe(true);
    }
  });

  it('FAILED libera QR: é o caminho documentado de recuperação', () => {
    expect(describeStatus('FAILED').canFetchQr).toBe(true);
  });

  it('STOPPED NÃO libera QR: primeiro é preciso iniciar a sessão', () => {
    // Pedir QR de uma sessão parada devolve 422 no WAHA, então a tela
    // não deve oferecer o botão.
    expect(describeStatus('STOPPED').canFetchQr).toBe(false);
  });

  it('passkey não vira QR — o QR não resolve esse caso', () => {
    const required = describeStatus('PASSKEY_REQUIRED');
    expect(required.state).toBe('action');
    expect(required.canFetchQr).toBe(false);
    expect(required.messageKey).toBe('statusNeedsPasskey');

    const confirm = describeStatus('PASSKEY_CONFIRMATION_REQUIRED');
    expect(confirm.canFetchQr).toBe(false);
    expect(confirm.messageKey).toBe('statusNeedsConfirmation');
  });

  it('status desconhecido ainda oferece reconectar', () => {
    // Se o WAHA mudar a lista de status, o usuário não pode ficar sem
    // saída: reconectar é sempre oferecido no pior caso.
    const view = describeStatus('ALGO_NOVO_DO_WAHA');
    expect(view.state).toBe('unknown');
    expect(view.canReconnect).toBe(true);
    expect(view.rawStatus).toBe('UNKNOWN');
  });

  it('todo estado tem messageKey (nenhuma tela em branco)', () => {
    for (const status of [...WAHA_STATUSES, 'BANANA']) {
      expect(describeStatus(status).messageKey).toBeTruthy();
    }
  });
});

describe('toEpochMs', () => {
  it('converte segundos em milissegundos', () => {
    expect(toEpochMs(1784477333)).toBe(1784477333000);
  });

  it('não multiplica um valor que já está em milissegundos', () => {
    const ms = 1784477333000;
    expect(toEpochMs(ms)).toBe(ms);
  });

  it('devolve null para valores ausentes ou inválidos', () => {
    expect(toEpochMs(null)).toBeNull();
    expect(toEpochMs(undefined)).toBeNull();
    expect(toEpochMs(0)).toBeNull();
    expect(toEpochMs(-5)).toBeNull();
    expect(toEpochMs(Number.NaN)).toBeNull();
  });
});

describe('describeConflicts', () => {
  it('sem restrição nenhuma, não inventa conflito', () => {
    expect(
      describeConflicts({
        timelock: { isActive: false },
        capping: { cappingStatus: 'NONE', totalQuota: 1000, usedQuota: 10 },
      })
    ).toEqual([]);
  });

  it('timelock ativo vira um aviso com a data de fim', () => {
    const [conflict] = describeConflicts({
      timelock: {
        isActive: true,
        enforcementType: 'RESTRICT_ALL_COMPANIONS',
        timeEnforcementEnds: 1784477333,
      },
    });
    expect(conflict.messageKey).toBe('conflictTimelock');
    expect(conflict.severity).toBe('warning');
    expect(conflict.endsAt).toBe(1784477333000);
  });

  it('timelock é aviso, não erro crítico: a conexão está boa', () => {
    const [conflict] = describeConflicts({ timelock: { isActive: true } });
    expect(conflict.severity).not.toBe('critical');
  });

  it.each([
    ['CAPPED', 'conflictCapped', 'warning'],
    ['SECOND_WARNING', 'conflictCappingHigh', 'warning'],
    ['FIRST_WARNING', 'conflictCappingLow', 'info'],
  ] as const)('capping %s → %s (%s)', (status, key, severity) => {
    const [conflict] = describeConflicts({
      capping: {
        cappingStatus: status,
        totalQuota: 1000,
        usedQuota: 640,
        cycleEnd: 1785553199,
      },
    });
    expect(conflict.messageKey).toBe(key);
    expect(conflict.severity).toBe(severity);
    expect(conflict.values).toMatchObject({ used: 640, total: 1000 });
    expect(conflict.endsAt).toBe(1785553199000);
  });

  it('capping em caixa baixa ainda é reconhecido', () => {
    const [conflict] = describeConflicts({
      capping: { cappingStatus: 'capped', totalQuota: 10, usedQuota: 10 },
    });
    expect(conflict.messageKey).toBe('conflictCapped');
  });

  it('os dois problemas juntos: o mais grave vem primeiro', () => {
    const conflicts = describeConflicts({
      timelock: { isActive: true, timeEnforcementEnds: 1784477333 },
      capping: { cappingStatus: 'FIRST_WARNING', totalQuota: 1000, usedQuota: 640 },
    });
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0].severity).toBe('warning');
    expect(conflicts[1].severity).toBe('info');
  });

  it('cappingStatus ausente não gera conflito', () => {
    expect(describeConflicts({ capping: { totalQuota: 1000, usedQuota: 5 } })).toEqual(
      []
    );
  });
});

describe('cappingUsagePercent', () => {
  it('calcula a porcentagem usada', () => {
    expect(
      cappingUsagePercent({ totalQuota: 1000, usedQuota: 640 })
    ).toBe(64);
  });

  it('totalQuota -1 significa sem limite, não 100%', () => {
    // Se isso regredir, a tela mostra "conta ilimitada" como esgotada.
    expect(cappingUsagePercent({ totalQuota: -1, usedQuota: 5 })).toBeNull();
  });

  it('nunca passa de 100 nem fica negativo', () => {
    expect(cappingUsagePercent({ totalQuota: 10, usedQuota: 99 })).toBe(100);
    expect(cappingUsagePercent({ totalQuota: 10, usedQuota: -3 })).toBe(0);
  });

  it('devolve null quando falta informação', () => {
    expect(cappingUsagePercent(null)).toBeNull();
    expect(cappingUsagePercent({ totalQuota: 10 })).toBeNull();
  });
});

describe('formatPhoneFromJid', () => {
  it('formata um celular brasileiro com 9 dígitos', () => {
    // Número fictício: testes de repositório público não levam telefone real.
    expect(formatPhoneFromJid('5511987654321@c.us')).toBe('+55 11 98765-4321');
  });

  it('formata um fixo brasileiro com 8 dígitos', () => {
    expect(formatPhoneFromJid('551133334444@c.us')).toBe('+55 11 3333-4444');
  });

  it('números de fora do Brasil recebem só o +', () => {
    expect(formatPhoneFromJid('14155552671@c.us')).toBe('+14155552671');
  });

  it('devolve null para entrada ausente ou curta demais', () => {
    expect(formatPhoneFromJid(null)).toBeNull();
    expect(formatPhoneFromJid('123@c.us')).toBeNull();
    expect(formatPhoneFromJid('')).toBeNull();
  });
});
