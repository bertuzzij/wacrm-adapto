import { describe, expect, it } from 'vitest';

import { applyGroupSignature, stripGroupSignature } from './signature';

describe('applyGroupSignature', () => {
  it('aplica negrito por padrão', () => {
    expect(applyGroupSignature('Bom dia, pessoal', { agentName: 'Ana' })).toBe(
      '*Ana:* Bom dia, pessoal'
    );
  });

  it('aceita o estilo entre colchetes', () => {
    expect(
      applyGroupSignature('Bom dia', { agentName: 'Ana', style: 'brackets' })
    ).toBe('[Ana] Bom dia');
  });

  it('não assina quando a conta desligou', () => {
    // O texto tem que sair exatamente como foi digitado.
    expect(
      applyGroupSignature('Bom dia', { agentName: 'Ana', enabled: false })
    ).toBe('Bom dia');
  });

  it('não assina sem nome de agente', () => {
    // Mensagem enviada por bot ou por um caminho sem usuário humano.
    expect(applyGroupSignature('Bom dia', {})).toBe('Bom dia');
    expect(applyGroupSignature('Bom dia', { agentName: '' })).toBe('Bom dia');
    expect(applyGroupSignature('Bom dia', { agentName: '   ' })).toBe('Bom dia');
  });

  it('não assina texto vazio', () => {
    expect(applyGroupSignature('', { agentName: 'Ana' })).toBe('');
    expect(applyGroupSignature('   ', { agentName: 'Ana' })).toBe('   ');
  });

  it('não duplica a assinatura num retry', () => {
    // O retry do WAHA reenvia o mesmo texto; sem esta guarda o cliente
    // receberia "*Ana:* *Ana:* ...".
    const once = applyGroupSignature('Olá', { agentName: 'Ana' });
    expect(applyGroupSignature(once, { agentName: 'Ana' })).toBe(once);
  });

  it('não confunde o prefixo de outro agente com o próprio', () => {
    const fromAna = applyGroupSignature('Olá', { agentName: 'Ana' });
    expect(applyGroupSignature(fromAna, { agentName: 'Bruno' })).toBe(
      '*Bruno:* *Ana:* Olá'
    );
  });

  it('preserva quebras de linha e o texto como foi escrito', () => {
    const out = applyGroupSignature('linha 1\nlinha 2', { agentName: 'Ana' });
    expect(out).toBe('*Ana:* linha 1\nlinha 2');
  });

  it('remove espaço à esquerda antes de assinar', () => {
    expect(applyGroupSignature('   oi', { agentName: 'Ana' })).toBe('*Ana:* oi');
  });

  it('lida com nome contendo espaço', () => {
    expect(applyGroupSignature('oi', { agentName: 'Ana Paula' })).toBe(
      '*Ana Paula:* oi'
    );
  });
});

describe('stripGroupSignature', () => {
  it('remove a assinatura em negrito', () => {
    expect(stripGroupSignature('*Ana:* Bom dia')).toBe('Bom dia');
  });

  it('remove a assinatura entre colchetes', () => {
    expect(stripGroupSignature('[Ana] Bom dia')).toBe('Bom dia');
  });

  it('deixa texto sem assinatura intacto', () => {
    expect(stripGroupSignature('Bom dia')).toBe('Bom dia');
  });

  it('remove só a primeira assinatura', () => {
    expect(stripGroupSignature('*Ana:* *Bruno:* oi')).toBe('*Bruno:* oi');
  });
});
