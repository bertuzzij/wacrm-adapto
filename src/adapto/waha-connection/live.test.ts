/**
 * Verificação contra o WAHA real (não é um teste de unidade — pula se o
 * ambiente não estiver configurado). Rodar com:
 *
 *   npx vitest run src/adapto/waha-connection/live.check.ts
 *
 * Fica fora do padrão `*.test.ts` de propósito: depende de rede e de uma
 * sessão de produção, então não pode entrar no `npm test`.
 */
import { describe, it, expect } from 'vitest';

import {
  fetchSession,
  fetchTimelock,
  fetchCapping,
  fetchQrDataUrl,
  reconnect,
  WahaTransportError,
} from './server';
import {
  describeStatus,
  describeConflicts,
  cappingUsagePercent,
  formatPhoneFromJid,
} from './status';

const configured = Boolean(process.env.WAHA_URL?.trim());

describe.skipIf(!configured)('WAHA real', () => {
  it('le a sessao e interpreta o status', async () => {
    const session = await fetchSession();
    console.log('  sessao:', session.name);
    console.log('  status:', session.status);
    console.log('  telefone:', formatPhoneFromJid(session.meId));
    console.log('  nome:', session.pushName);

    expect(session.name).toBeTruthy();
    expect(session.status).toBeTruthy();

    const view = describeStatus(session.status);
    console.log('  estado:', view.state, '| qr:', view.canFetchQr, '| reconectar:', view.canReconnect);
    expect(view.messageKey).toBeTruthy();
  });

  it('le timelock e cota sem quebrar quando indisponiveis', async () => {
    const session = await fetchSession();
    console.log('  reachoutTimelock do /me:', session.reachoutTimelock ? JSON.stringify(session.reachoutTimelock) : 'null');

    // O endpoint /timelock não existe na 2026.7.2 CORE; a função deve cair
    // no valor do /me em vez de estourar.
    const timelock = await fetchTimelock();
    console.log('  timelock (fonte):', timelock ? `${timelock.source} ${JSON.stringify({ isActive: timelock.isActive })}` : 'null');

    const capping = await fetchCapping();
    console.log('  capping:', capping ? JSON.stringify(capping) : 'null (versao sem o endpoint)');
    console.log('  uso:', cappingUsagePercent(capping));

    const conflicts = describeConflicts({ timelock, capping });
    console.log('  conflitos:', conflicts.length);
    expect(Array.isArray(conflicts)).toBe(true);
  }, 25_000);

  it('recusa o QR quando a sessao nao esta esperando pareamento', async () => {
    const session = await fetchSession();
    if (session.status.toUpperCase() === 'SCAN_QR_CODE') {
      const qr = await fetchQrDataUrl();
      expect(qr?.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
      console.log('  QR obtido:', qr?.dataUrl.length, 'chars');
      return;
    }
    // Fora de SCAN_QR_CODE o WAHA devolve 422; a camada traduz em erro
    // tipado em vez de deixar vazar um "erro 422" para a tela.
    await expect(fetchQrDataUrl()).rejects.toBeInstanceOf(WahaTransportError);
    console.log('  QR recusado corretamente para status', session.status);
    // O WAHA pode demorar a devolver o 422; o timeout padrão do vitest
    // (5s) é curto para uma chamada de rede real.
  }, 25_000);

  it('reconnect em sessao saudavel e no-op (nao derruba producao)', async () => {
    const before = await fetchSession();
    if (before.status.toUpperCase() !== 'WORKING') {
      console.log('  sessao nao esta WORKING, pulando para nao interferir');
      return;
    }
    const result = await reconnect();
    expect(result.action).toBe('none');

    const after = await fetchSession();
    expect(after.status).toBe(before.status);
    expect(after.meId).toBe(before.meId);
    console.log('  no-op confirmado, sessao intacta:', after.status);
  });
});
