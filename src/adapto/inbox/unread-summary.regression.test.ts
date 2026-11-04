import { describe, expect, it } from 'vitest';

import {
  formatUnreadBadge,
  shouldShowUnreadIndicator,
} from './unread-summary';

// ============================================================
// Regressão do incidente em produção.
//
// O sino no cabeçalho e o badge do menu lateral precisavam da mesma
// contagem. A primeira tentativa chamou `useTotalUnread()` nos dois, mas o
// hook usava um nome de canal FIXO. supabase-js deduplica canais por nome
// e devolve a MESMA instância, então o segundo `.on()` estourou:
//
//   cannot add `postgres_changes` callbacks for
//   realtime:total-unread-realtime after `subscribe()`
//
// O erro subiu pelo render e a página inteira caiu ("This page couldn't
// load"). Estes testes travam as invariantes que impedem a repetição.
// ============================================================

describe('regressão: contagem de não-lidas não pode duplicar subscription', () => {
  it('o nome do canal precisa ser único por instância, nunca constante', async () => {
    // Guarda estática: se alguém voltar a usar um literal fixo em
    // useTotalUnread, este teste avisa antes do deploy.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/hooks/use-total-unread.ts', 'utf8')
    );

    // O canal é construído a partir de uma variável derivada de useId().
    expect(src).toMatch(/useId\(\)/);
    expect(src).toMatch(/channelName/);
    // E o literal antigo, que era o bug, não pode reaparecer.
    expect(src).not.toMatch(/\.channel\("total-unread-realtime"\)/);
  });

  it('useId é sanitizado para caber num nome de canal', async () => {
    // React ids vêm como ":r0:" e os dois-pontos não pertencem a um nome
    // de canal. O hook precisa limpar antes de compor o nome.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/hooks/use-total-unread.ts', 'utf8')
    );
    expect(src).toMatch(/replace\(\/\[\^a-zA-Z0-9_-\]\/g/);
  });

  it('o sino e o menu leem o valor de um contexto, não do hook cada um', async () => {
    // A correção definitiva: uma subscription só, compartilhada. Se o
    // sidebar ou o header voltarem a chamar useTotalUnread direto, o
    // canal duplica de novo.
    const fs = await import('node:fs');

    const sidebar = fs.readFileSync(
      'src/components/layout/sidebar.tsx',
      'utf8'
    );
    const header = fs.readFileSync(
      'src/components/layout/header.tsx',
      'utf8'
    );

    expect(sidebar).not.toMatch(/useTotalUnread\(\)/);
    expect(header).not.toMatch(/useTotalUnread\(\)/);
    expect(sidebar).toMatch(/useUnreadCount\(\)/);
    expect(header).toMatch(/useUnreadCount\(\)/);
  });

  it('o provider monta o hook uma única vez', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/adapto/inbox/unread-count-context.tsx', 'utf8')
    );
    // Conta CHAMADAS reais, ignorando comentários — o texto explicativo
    // cita o nome do hook e não deve ser confundido com uso.
    const chamadas = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n')
      .match(/useTotalUnread\(\)/g);
    expect(chamadas?.length ?? 0).toBe(1);
  });
});

describe('badge e indicador continuam coerentes após a correção', () => {
  it('o menu lateral mostra a contagem mesmo na seção ativa', () => {
    // O bug original relatado: o aviso sumia ao abrir o inbox.
    expect(
      shouldShowUnreadIndicator({ total: 3, isActiveSection: true })
    ).toBe(true);
    expect(formatUnreadBadge(3)).toBe('3');
  });

  it('sem não-lidas não há badge, mas o item segue clicável', () => {
    expect(
      shouldShowUnreadIndicator({ total: 0, isActiveSection: true })
    ).toBe(false);
    expect(formatUnreadBadge(0)).toBeNull();
  });
});
