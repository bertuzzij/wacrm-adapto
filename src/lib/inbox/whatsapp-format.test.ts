import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WhatsAppText } from './whatsapp-format';

function render(text: string, isAgent = false) {
  return renderToStaticMarkup(createElement(WhatsAppText, { text, isAgent }));
}

/**
 * O parser devolve nós React; para testar, extraio o texto visível e as
 * marcas de estilo do HTML renderizado. É o que o usuário vê.
 */
describe('WhatsAppText — formatação do WhatsApp', () => {
  it('texto sem marcadores passa intacto', () => {
    const html = render('Olá, tudo bem?');
    expect(html).toContain('Olá, tudo bem?');
    expect(html).not.toContain('font-weight');
  });

  it('*negrito* vira bold', () => {
    const html = render('olá *mundo*');
    expect(html).toContain('font-weight:700');
    expect(html).toContain('>mundo<');
    // O marcador desaparece da renderização.
    expect(html).not.toContain('*mundo*');
  });

  it('_itálico_ vira italic', () => {
    const html = render('isso é _importante_');
    expect(html).toContain('font-style:italic');
    expect(html).toContain('>importante<');
  });

  it('~riscado~ vira line-through', () => {
    const html = render('isso ~não vale~');
    expect(html).toContain('line-through');
  });

  it('`código` vira monoespaçado com fundo', () => {
    const html = render('rode `npm run dev` hoje');
    expect(html).toContain('monospace');
    expect(html).toContain('>npm run dev<');
  });

  it('combinados na mesma linha', () => {
    const html = render('*a* e _b_ e ~c~');
    expect(html).toContain('font-weight:700');
    expect(html).toContain('font-style:italic');
    expect(html).toContain('line-through');
  });

  it('delimitador sem par fica literal (igual ao WhatsApp)', () => {
    const html = render('preço *a combinar e _outro');
    // Nada foi formatado — os marcadores continuam visíveis.
    expect(html).not.toContain('font-weight:700');
    expect(html).not.toContain('font-style:italic');
    expect(html).toContain('*a combinar');
  });

  it('quebra de linha é preservada', () => {
    const html = render('linha 1\nlinha 2');
    expect(html).toContain('linha 1');
    expect(html).toContain('linha 2');
  });

  it('citação com > no início da linha', () => {
    const html = render('> texto citado\nresposta');
    // A citação ganha a barra lateral (border-left).
    expect(html).toContain('border-left');
    expect(html).toContain('texto citado');
  });

  it('citação funciona também com > sem espaço', () => {
    const html = render('>citação');
    expect(html).toContain('border-left');
  });

  it('> no meio da linha é texto comum', () => {
    const html = render('dizem que 5 > 3 sempre');
    expect(html).not.toContain('border-left');
  });

  it('não vira HTML — texto malicioso fica literal', () => {
    const html = render('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('negrito contendo itálico aninha', () => {
    const html = render('*negrito com _itálico_ dentro*');
    expect(html).toContain('font-weight:700');
    expect(html).toContain('font-style:italic');
  });

  it('marcador dentro de palavra não formata (igual WhatsApp exige espaço/pontuação)', () => {
    // WhatsApp só formata quando o delimitador tem fronteira adequada;
    // simplifico para: marcador colado em letra NÃO abre formatação.
    const html = render('pro*duto_');
    // `pro*duto_` — o `*` não abre par, fica literal.
    expect(html).not.toContain('font-weight:700');
  });

  it('texto vazio não quebra', () => {
    expect(render('')).toBe('<span></span>');
  });
});
