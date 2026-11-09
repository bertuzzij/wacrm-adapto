import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================
// Regressão: a bolha de vídeo não pode buscar bytes ao montar.
//
// Relato: "todos os vídeos já rodam automaticamente... isso vai sobrecarregar
// meu storage". O custo real era o `<video src>` montado junto com a bolha:
// o navegador busca o arquivo só por a conversa ser aberta, e no nosso
// caminho cada byte atravessa a RAM do servidor (o proxy não repassa Range).
//
// Estes testes leem o código-fonte de propósito. Um teste de renderização
// com JSDOM não pegaria o problema: o `<video>` só dispara a busca de rede
// num navegador real. O que dá para garantir de forma determinística é que
// o elemento com `src` apontando para o arquivo não existe no caminho de
// render inicial — e para isso o código precisa ser lido.
// ============================================================

/**
 * Código executável, sem comentários.
 *
 * Remove `//` de linha inteira, blocos `/* *\/` e comentários JSX
 * `{/* *\/}`. Sem isso, um comentário que MENCIONA `<video>` faria o
 * teste contar dois elementos e falhar por engano — foi o que aconteceu
 * na primeira versão deste arquivo.
 */
function executableOnly(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .filter((line) => !line.trim().startsWith('*'))
    .join('\n');
}

const bubble = readFileSync(
  'src/adapto/video-playback/lazy-video-bubble.tsx',
  'utf8'
);

const code = executableOnly(bubble);

describe('LazyVideoBubble não carrega o vídeo ao montar', () => {
  it('o <video> só aparece dentro do ramo de "playing"', () => {
    // A guarda de render é o que separa "usuário pediu" de "conversa abriu".
    expect(code).toContain('if (playing)');
    const playingGuard = code.indexOf('if (playing)');
    const videoTag = code.indexOf('<video');
    expect(videoTag).toBeGreaterThan(playingGuard);
  });

  it('não liga autoPlay fora do pedido explícito', () => {
    // `autoPlay` é legítimo DENTRO do player que o usuário abriu — o que
    // não pode é existir um player sempre montado com autoplay.
    const videoTag = code.slice(code.indexOf('<video'));
    expect(videoTag).toContain('autoPlay');
    // Um único elemento <video> no arquivo: se houvesse um segundo, ele
    // seria um player fora da guarda — o bug que este arquivo previne.
    // (Comentários já foram removidos de `code`.)
    expect(code.split('<video').length - 1).toBe(1);
  });

  it('o estado inicial é "não pedi", não "tocando"', () => {
    expect(code).toMatch(/useState\(false\)/);
    expect(code).not.toMatch(/useState\(true\)/);
  });

  it('o cartão usa o módulo de decisão, não regra própria', () => {
    // Tamanho/limite decidem se há play; duplicar a regra aqui faria as
    // duas divergirem com o tempo.
    expect(code).toContain('videoPresentation');
    expect(code).toContain('videoCardSubtitle');
  });
});

describe('o bubble do inbox usa a bolha preguiçosa', () => {
  const messageBubble = readFileSync(
    'src/components/inbox/message-bubble.tsx',
    'utf8'
  );
  const live = executableOnly(messageBubble);

  it('importa LazyVideoBubble', () => {
    expect(live).toContain('LazyVideoBubble');
  });

  it('não usa mais o player automático do upstream', () => {
    // `MediaVideoBubble` monta `<video src=…>` direto; voltar a usá-lo
    // traria o problema de volta sem ninguém perceber.
    expect(live).not.toContain('MediaVideoBubble');
  });

  it('cobre os dois pontos de render de vídeo', () => {
    // Header de template e conteúdo normal; esquecer um deixaria um
    // caminho carregando o vídeo automaticamente.
    const usos = live.split('LazyVideoBubble').length - 1;
    expect(usos).toBeGreaterThanOrEqual(3); // import + 2 usos
  });
});
