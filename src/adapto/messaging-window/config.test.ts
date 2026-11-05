import { describe, expect, it } from 'vitest';

import {
  WINDOW_MS,
  expiringFilterApplies,
  resolveMessagingWindow,
} from './config';

/** "Agora" fixo: nenhum teste pode depender do relógio da máquina. */
const NOW = new Date('2026-11-05T12:00:00.000Z');

/** Uma data `hours` horas antes de NOW. */
function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

describe('resolveMessagingWindow com a janela LIGADA', () => {
  it('não expira com mensagem recente e mostra as horas restantes', () => {
    // 5h decorridas de 24h → restam 19h.
    const state = resolveMessagingWindow(true, hoursAgo(5), NOW);

    expect(state.expired).toBe(false);
    expect(state.labelKey).toBe('xhRemaining');
    expect(state.hours).toBe(19);
  });

  it('expira depois de 24h', () => {
    const state = resolveMessagingWindow(true, hoursAgo(25), NOW);

    expect(state.expired).toBe(true);
    expect(state.labelKey).toBe('expired');
  });

  it('trata a borda exata de 24h como expirada', () => {
    // Era `>= 24` no componente original; preservar isso importa, porque
    // na Meta a janela já fechou no instante exato.
    const state = resolveMessagingWindow(true, hoursAgo(24), NOW);

    expect(state.expired).toBe(true);
    expect(state.labelKey).toBe('expired');
  });

  it('usa minutos quando falta menos de uma hora', () => {
    // 23h30 decorridas → 30 minutos restantes.
    const lastAt = new Date(NOW.getTime() - (WINDOW_MS - 30 * 60 * 1000));
    const state = resolveMessagingWindow(true, lastAt, NOW);

    expect(state.expired).toBe(false);
    expect(state.labelKey).toBe('xmRemaining');
    expect(state.minutes).toBe(30);
  });

  it('expira quando o cliente nunca escreveu', () => {
    const state = resolveMessagingWindow(true, null, NOW);

    expect(state.expired).toBe(true);
    expect(state.labelKey).toBe('noCustomerMessages');
  });
});

describe('resolveMessagingWindow com a janela DESLIGADA', () => {
  it('não expira nem com mensagem de 3 dias atrás', () => {
    // É o ponto do recurso: no WAHA a mensagem passaria, então a
    // interface não pode impedir o atendente.
    const state = resolveMessagingWindow(false, hoursAgo(72), NOW);

    expect(state.expired).toBe(false);
    expect(state.labelKey).toBe('noWindow');
  });

  it('não expira quando o cliente nunca escreveu', () => {
    // Primeiro contato de uma conta nova não pode ficar sem compositor.
    const state = resolveMessagingWindow(false, null, NOW);

    expect(state.expired).toBe(false);
    expect(state.labelKey).toBe('noWindow');
  });

  it('não devolve contagem regressiva junto com o rótulo de janela desligada', () => {
    // Um número ao lado de "sem janela" seria contraditório na tela.
    const state = resolveMessagingWindow(false, hoursAgo(1), NOW);

    expect(state.hours).toBeUndefined();
    expect(state.minutes).toBeUndefined();
  });
});

describe('expiringFilterApplies', () => {
  it('mostra o filtro só com a janela ligada', () => {
    expect(expiringFilterApplies(true)).toBe(true);
    expect(expiringFilterApplies(false)).toBe(false);
  });
});
