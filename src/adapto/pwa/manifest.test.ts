import { describe, expect, it } from 'vitest';
import { buildManifest } from './manifest';
import { PWA_BACKGROUND_COLOR, PWA_THEME_COLOR } from './constants';

/**
 * O manifest é o que decide se o navegador oferece "Instalar". Um campo
 * errado aqui não quebra nenhum teste de componente e não aparece em
 * desenvolvimento (o Chrome só valida na origem real, em HTTPS), então
 * estes testes são a única rede de proteção antes do deploy.
 */
describe('web app manifest', () => {
  const manifest = buildManifest();

  it('carrega os campos que o Chrome exige para considerar instalável', () => {
    // Sem qualquer um destes o Chrome não considera o app instalável.
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons?.length).toBeGreaterThan(0);
  });

  it('tem um ícone de 192 e um de 512 para instalar', () => {
    const sizes = (manifest.icons ?? [])
      .filter((icon) => icon.purpose === 'any')
      .map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('declara ícones maskable em arquivos SEPARADOS dos "any"', () => {
    // `purpose: "any maskable"` no mesmo arquivo é a armadilha clássica: o
    // Android recorta em círculo e o glifo aparece cortado. Os arquivos
    // maskable precisam ter zona segura própria.
    const any = (manifest.icons ?? [])
      .filter((icon) => icon.purpose === 'any')
      .map((icon) => icon.src);
    const maskable = (manifest.icons ?? [])
      .filter((icon) => icon.purpose === 'maskable')
      .map((icon) => icon.src);

    expect(maskable.length).toBeGreaterThan(0);
    for (const src of maskable) {
      expect(any).not.toContain(src);
    }
    // O `purpose` do tipo do Next é uma string única, então
    // "any maskable" nem compila — mas um registro combinado passaria se
    // alguém trocasse o tipo. Garantir que 192 e 512 estão cobertos:
    const maskableSizes = (manifest.icons ?? [])
      .filter((icon) => icon.purpose === 'maskable')
      .map((icon) => icon.sizes);
    expect(maskableSizes).toContain('192x192');
    expect(maskableSizes).toContain('512x512');
  });

  it('fixa `id` para a instalação não se duplicar ao mudar start_url', () => {
    // Sem `id`, mudar start_url faria o navegador tratar como outro app:
    // ícone duplicado e instalação antiga órfã.
    expect(manifest.id).toBe('/');
  });

  it('usa escopo raiz, para a navegação interna ficar na janela do app', () => {
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url?.startsWith('/')).toBe(true);
  });

  it('reaproveita a cor de fundo do tema escuro, para a splash não piscar', () => {
    expect(manifest.theme_color).toBe(PWA_THEME_COLOR);
    expect(manifest.background_color).toBe(PWA_BACKGROUND_COLOR);
    // Se o tema escuro mudar em globals.css, este valor precisa mudar junto.
    expect(PWA_BACKGROUND_COLOR).toBe('#020617');
  });

  it('não pede app relacionado (esconderia o botão Instalar)', () => {
    expect(manifest.prefer_related_applications).toBe(false);
  });

  it('expõe atalhos e todos apontam para rotas internas', () => {
    const shortcuts = manifest.shortcuts ?? [];
    expect(shortcuts.length).toBeGreaterThan(0);
    for (const shortcut of shortcuts) {
      expect(shortcut.name).toBeTruthy();
      expect(shortcut.url.startsWith('/')).toBe(true);
    }
  });

  it('tem nome curto que cabe embaixo do ícone (~12 caracteres)', () => {
    expect((manifest.short_name ?? '').length).toBeLessThanOrEqual(12);
  });
});
