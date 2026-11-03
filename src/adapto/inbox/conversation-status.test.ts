import { describe, expect, it } from 'vitest';

import {
  STATUS_DOT_COLORS,
  shouldShowStatusDot,
  statusLabelKey,
} from './conversation-status';

describe('shouldShowStatusDot', () => {
  it('não desenha ponto para conversa aberta', () => {
    // Regressão: o ponto verde em `open` era lido como "mensagem não
    // lida" e fazia conversas já lidas parecerem pendentes.
    expect(shouldShowStatusDot('open')).toBe(false);
  });

  it('desenha ponto para pendente', () => {
    // "Pendente" é justamente o estado que precisa chamar atenção.
    expect(shouldShowStatusDot('pending')).toBe(true);
  });

  it('desenha ponto para fechada', () => {
    expect(shouldShowStatusDot('closed')).toBe(true);
  });

  it('só o estado aberto fica sem marca', () => {
    const semMarca = (['open', 'pending', 'closed'] as const).filter(
      (s) => !shouldShowStatusDot(s)
    );
    expect(semMarca).toEqual(['open']);
  });
});

describe('STATUS_DOT_COLORS', () => {
  it('cobre os três status', () => {
    expect(Object.keys(STATUS_DOT_COLORS).sort()).toEqual([
      'closed',
      'open',
      'pending',
    ]);
  });

  it('dá uma cor a cada status, sem repetir', () => {
    // Cores repetidas tornariam dois estados indistinguíveis na lista.
    const cores = Object.values(STATUS_DOT_COLORS);
    expect(new Set(cores).size).toBe(cores.length);
  });

  it('toda cor é uma classe utilitária não vazia', () => {
    for (const cor of Object.values(STATUS_DOT_COLORS)) {
      expect(cor.startsWith('bg-')).toBe(true);
    }
  });
});

describe('statusLabelKey', () => {
  it('monta a chave no formato que o componente procura', () => {
    expect(statusLabelKey('open')).toBe('status.open');
    expect(statusLabelKey('pending')).toBe('status.pending');
    expect(statusLabelKey('closed')).toBe('status.closed');
  });

  it('não traduz o valor, porque ele é parte da chave i18n', () => {
    // Traduzir aqui faria `t("status.Aberta")` e a tradução se perderia.
    expect(statusLabelKey('open')).not.toContain('Aberta');
  });
});
