// ============================================================
// Regras puras dos modos de cor (light / grey / dark).
//
// Centraliza a rotação do botão rápido do cabeçalho e o mapeamento
// para bibliotecas externas (como o `sonner`) que só aceitam
// 'light' | 'dark'.
// ============================================================

import { MODES, type Mode } from '@/lib/themes';

/** Próximo modo ao clicar no botão de alternância rápida do cabeçalho. */
export function nextMode(current: Mode): Mode {
  const index = MODES.indexOf(current);
  if (index === -1) return MODES[0];
  return MODES[(index + 1) % MODES.length];
}

/**
 * Tema base para bibliotecas que só aceitam `light` ou `dark` (ex.: sonner).
 *
 * O modo `grey` usa superfícies médias-escuras com texto claro, então
 * mapeia para `dark`.
 */
export function sonnerThemeFor(mode: Mode): 'light' | 'dark' {
  return mode === 'light' ? 'light' : 'dark';
}
