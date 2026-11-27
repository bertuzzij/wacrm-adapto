import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { THEMES, THEME_IDS, isThemeId } from '@/lib/themes';

const ROOT = process.cwd();

describe('tema Lima Grafite', () => {
  it('está registrado em THEME_IDS e aceito por isThemeId', () => {
    expect(THEME_IDS).toContain('lima-grafite');
    expect(isThemeId('lima-grafite')).toBe(true);
  });

  it('aparece no catálogo THEMES com nome e swatch OKLCH', () => {
    const meta = THEMES.find((t) => t.id === 'lima-grafite');
    expect(meta).toBeDefined();
    expect(meta?.name).toBe('Lima Grafite');
    expect(meta?.swatch).toMatch(/^oklch\(/);
  });

  it('define tokens escuros e claros e é importado pelo globals.css', () => {
    const css = readFileSync(join(ROOT, 'src/adapto/themes/lima-grafite.css'), 'utf8');
    const globals = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8');

    expect(globals).toContain('../adapto/themes/lima-grafite.css');
    expect(css).toContain('html[data-theme="lima-grafite"][data-mode="dark"]');
    expect(css).toContain('html[data-theme="lima-grafite"][data-mode="light"]');

    for (const token of [
      '--background:',
      '--card:',
      '--sidebar:',
      '--border:',
      '--primary:',
      '--primary-foreground:',
      '--primary-hover:',
      '--primary-soft:',
      '--primary-soft-2:',
      '--ring:',
      '--chart-1:',
      '--sidebar-primary:',
    ]) {
      expect(css).toContain(token);
    }
  });
});
