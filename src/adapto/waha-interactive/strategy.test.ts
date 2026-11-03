import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INTERACTIVE_MODE,
  buttonsAsList,
  interactiveStrategies,
  parseInteractiveMode,
  pollPayloadFor,
} from './strategy';

describe('parseInteractiveMode', () => {
  it('aceita os quatro modos válidos', () => {
    expect(parseInteractiveMode('list')).toBe('list');
    expect(parseInteractiveMode('poll')).toBe('poll');
    expect(parseInteractiveMode('buttons')).toBe('buttons');
    expect(parseInteractiveMode('text')).toBe('text');
  });

  it('ignora caixa e espaços em volta', () => {
    expect(parseInteractiveMode('  LIST  ')).toBe('list');
    expect(parseInteractiveMode('Buttons')).toBe('buttons');
  });

  it('cai no padrão quando ausente ou vazio', () => {
    expect(parseInteractiveMode(undefined)).toBe(DEFAULT_INTERACTIVE_MODE);
    expect(parseInteractiveMode('')).toBe(DEFAULT_INTERACTIVE_MODE);
    expect(parseInteractiveMode('   ')).toBe(DEFAULT_INTERACTIVE_MODE);
  });

  it('cai no padrão quando o valor é desconhecido', () => {
    // "list" não era um valor válido antes; um deploy antigo que ainda
    // escreva lixo na env não pode derrubar o envio.
    expect(parseInteractiveMode('nativo')).toBe(DEFAULT_INTERACTIVE_MODE);
    expect(parseInteractiveMode('true')).toBe(DEFAULT_INTERACTIVE_MODE);
    expect(parseInteractiveMode('0')).toBe(DEFAULT_INTERACTIVE_MODE);
  });

  it('o padrão não é enquete', () => {
    // Regressão: o padrão já foi 'poll', o que transformava toda lista e
    // todo botão em enquete sem o usuário pedir.
    expect(DEFAULT_INTERACTIVE_MODE).not.toBe('poll');
  });
});

describe('interactiveStrategies', () => {
  it('no modo list tenta nativo antes de degradar', () => {
    expect(interactiveStrategies('list')).toEqual(['native', 'poll', 'text']);
  });

  it('no modo buttons também tenta nativo primeiro', () => {
    expect(interactiveStrategies('buttons')).toEqual(['native', 'poll', 'text']);
  });

  it('no modo poll pula o nativo', () => {
    expect(interactiveStrategies('poll')).toEqual(['poll', 'text']);
  });

  it('no modo text vai direto para texto', () => {
    expect(interactiveStrategies('text')).toEqual(['text']);
  });

  it('toda estratégia termina em text, que sempre funciona', () => {
    for (const mode of ['list', 'buttons', 'poll', 'text'] as const) {
      expect(interactiveStrategies(mode).at(-1)).toBe('text');
    }
  });

  it('nenhuma estratégia repete', () => {
    for (const mode of ['list', 'buttons', 'poll', 'text'] as const) {
      const s = interactiveStrategies(mode);
      expect(new Set(s).size).toBe(s.length);
    }
  });
});

describe('buttonsAsList', () => {
  it('embrulha os botões numa única seção', () => {
    const r = buttonsAsList([
      { id: 'a', title: 'Sim' },
      { id: 'b', title: 'Não' },
    ]);
    expect(r).not.toBeNull();
    expect(r!.sections).toHaveLength(1);
    expect(r!.sections[0].rows).toEqual([
      { id: 'a', title: 'Sim' },
      { id: 'b', title: 'Não' },
    ]);
  });

  it('dá um rótulo ao botão que abre a lista', () => {
    // Sem rótulo o WhatsApp mostra um botão vazio e o cliente não sabe
    // que há opções escondidas ali.
    const r = buttonsAsList([{ id: 'a', title: 'Sim' }]);
    expect(r!.buttonLabel.trim().length).toBeGreaterThan(0);
  });

  it('preserva o id de cada opção', () => {
    // O id é o que volta no webhook; trocar por índice quebraria o
    // vínculo com a automação.
    const r = buttonsAsList([{ id: 'opt-42', title: 'Quarenta e dois' }]);
    expect(r!.sections[0].rows[0].id).toBe('opt-42');
  });

  it('devolve null sem botões, porque o WAHA exige uma linha', () => {
    expect(buttonsAsList([])).toBeNull();
  });

  it('devolve null quando todos os títulos estão vazios', () => {
    // Uma lista com linhas sem título é recusada pelo WhatsApp; melhor
    // pular para a próxima estratégia do que mandar algo inválido.
    expect(buttonsAsList([{ id: 'a', title: '   ' }])).toBeNull();
  });

  it('descarta só os botões sem título e mantém os demais', () => {
    const r = buttonsAsList([
      { id: 'a', title: 'Sim' },
      { id: 'b', title: '' },
    ]);
    expect(r!.sections[0].rows).toEqual([{ id: 'a', title: 'Sim' }]);
  });
});

describe('pollPayloadFor', () => {
  it('junta cabeçalho e corpo no nome da enquete', () => {
    const r = pollPayloadFor('Título', 'Escolha uma opção', [
      { options: [{ title: 'A' }] },
    ]);
    expect(r!.name).toBe('Título\nEscolha uma opção');
  });

  it('usa só o corpo quando não há cabeçalho', () => {
    const r = pollPayloadFor(undefined, 'Escolha', [{ options: [{ title: 'A' }] }]);
    expect(r!.name).toBe('Escolha');
  });

  it('respeita o limite de 250 caracteres do WhatsApp', () => {
    const r = pollPayloadFor(undefined, 'x'.repeat(400), [
      { options: [{ title: 'A' }] },
    ]);
    expect(r!.name).toHaveLength(250);
  });

  it('achata as opções de todas as seções, em ordem', () => {
    const r = pollPayloadFor(undefined, 'Cor', [
      { options: [{ title: 'Vermelho' }, { title: 'Azul' }] },
      { options: [{ title: 'Verde' }] },
    ]);
    expect(r!.options).toEqual(['Vermelho', 'Azul', 'Verde']);
  });

  it('devolve null sem opções, porque a API recusa enquete vazia', () => {
    expect(pollPayloadFor(undefined, 'Cor', [])).toBeNull();
    expect(pollPayloadFor(undefined, 'Cor', [{ options: [] }])).toBeNull();
  });

  it('devolve null quando as opções são só espaços', () => {
    expect(pollPayloadFor(undefined, 'Cor', [{ options: [{ title: '  ' }] }])).toBeNull();
  });

  it('nunca devolve nome vazio, que a API recusa com HTTP 500', () => {
    // Já aconteceu: sendPoll sem `name` respondeu 500
    // "Cannot read properties of undefined (reading 'name')".
    const r = pollPayloadFor(undefined, '   ', [{ options: [{ title: 'Única' }] }]);
    expect(r!.name.trim().length).toBeGreaterThan(0);
    expect(r!.name).toBe('Única');
  });

  it('corta o nome depois de juntar, não antes', () => {
    // Cortar o corpo antes de concatenar deixaria o cabeçalho sozinho no
    // limite, perdendo a pergunta.
    const r = pollPayloadFor('Cab', 'y'.repeat(300), [{ options: [{ title: 'A' }] }]);
    expect(r!.name.startsWith('Cab\ny')).toBe(true);
    expect(r!.name).toHaveLength(250);
  });
});
