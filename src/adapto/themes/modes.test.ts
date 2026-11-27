import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MODES, isMode } from '@/lib/themes';
import { nextMode, sonnerThemeFor } from './modes';

const ROOT = process.cwd();

describe('modo Grey', () => {
  it('está registrado em MODES e aceito por isMode', () => {
    expect(MODES).toEqual(['light', 'grey', 'dark']);
    expect(isMode('grey')).toBe(true);
    expect(isMode('invalid')).toBe(false);
  });

  it('alterna ciclicamente entre light → grey → dark → light', () => {
    expect(nextMode('light')).toBe('grey');
    expect(nextMode('grey')).toBe('dark');
    expect(nextMode('dark')).toBe('light');
  });

  it('mapeia grey para dark no sonner (superfície média-escura com texto claro)', () => {
    expect(sonnerThemeFor('light')).toBe('light');
    expect(sonnerThemeFor('grey')).toBe('dark');
    expect(sonnerThemeFor('dark')).toBe('dark');
  });

  it('define tokens de grey-mode.css, suporte em lima-grafite.css e import no globals.css', () => {
    const greyCss = readFileSync(join(ROOT, 'src/adapto/themes/grey-mode.css'), 'utf8');
    const limaCss = readFileSync(join(ROOT, 'src/adapto/themes/lima-grafite.css'), 'utf8');
    const globals = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8');

    expect(globals).toContain('../adapto/themes/grey-mode.css');
    expect(greyCss).toContain('html[data-mode="grey"]');
    expect(limaCss).toContain('html[data-theme="lima-grafite"][data-mode="grey"]');

    for (const token of ['--background:', '--card:', '--sidebar:', '--border:', '--foreground:']) {
      expect(greyCss).toContain(token);
    }
  });
});
