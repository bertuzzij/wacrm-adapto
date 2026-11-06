import { describe, expect, it } from 'vitest';

import {
  extractPastedFile,
  kindForMime,
  pastedFileName,
} from './paste';

/** `File` mínimo para o ambiente de teste (que não tem DOM). */
function fakeFile(name: string, type: string): File {
  return { name, type, size: 10 } as File;
}

describe('kindForMime', () => {
  it('reconhece os formatos de imagem aceitos pelo WhatsApp', () => {
    expect(kindForMime('image/png')).toBe('image');
    expect(kindForMime('image/jpeg')).toBe('image');
    expect(kindForMime('image/webp')).toBe('image');
  });

  it('reconhece vídeo', () => {
    expect(kindForMime('video/mp4')).toBe('video');
    expect(kindForMime('video/3gpp')).toBe('video');
  });

  it('reconhece documento', () => {
    expect(kindForMime('application/pdf')).toBe('document');
    expect(kindForMime('text/plain')).toBe('document');
  });

  it('ignora parâmetros do tipo', () => {
    expect(kindForMime('image/png; charset=binary')).toBe('image');
  });

  it('recusa formato que o WhatsApp não aceita', () => {
    // SVG é imagem no navegador mas é recusado pelo WhatsApp; virar
    // documento por engano mandaria um anexo que o cliente não abre.
    expect(kindForMime('image/svg+xml')).toBeNull();
    expect(kindForMime('image/gif')).toBeNull();
    expect(kindForMime('application/zip')).toBeNull();
    expect(kindForMime('')).toBeNull();
  });
});

describe('pastedFileName', () => {
  const now = new Date('2026-11-06T15:30:45Z').getTime();

  it('usa a extensão do tipo MIME', () => {
    expect(pastedFileName('image/png', now)).toBe('colado_2026-11-06_15-30-45.png');
    expect(pastedFileName('image/jpeg', now)).toBe('colado_2026-11-06_15-30-45.jpg');
    expect(pastedFileName('image/webp', now)).toBe('colado_2026-11-06_15-30-45.webp');
  });

  it('nome é datado, então dois prints no mesmo dia não colidem', () => {
    const a = pastedFileName('image/png', now);
    const b = pastedFileName('image/png', now + 1000);
    expect(a).not.toBe(b);
  });

  it('não deixa caractere inválido no nome', () => {
    // ":" não é válido em nome de arquivo no Windows, e o nome vai parar no
    // bucket do Storage.
    expect(pastedFileName('image/png', now)).not.toContain(':');
  });
});

describe('extractPastedFile', () => {
  it('lê a imagem de `items`, que é onde o Chrome a coloca', () => {
    const file = fakeFile('', 'image/png');
    const result = extractPastedFile(
      [{ kind: 'file', type: 'image/png' }],
      [], // files vazio: é assim que o Chrome se comporta
      () => file
    );

    expect(result?.kind).toBe('image');
    expect(result).not.toBeNull();
  });

  it('renomeia arquivo sem nome (blob do clipboard)', () => {
    const result = extractPastedFile(
      [{ kind: 'file', type: 'image/png' }],
      [],
      () => fakeFile('blob', 'image/png')
    );

    expect(result?.file.name).toMatch(/^colado_.*\.png$/);
  });

  it('preserva o nome quando ele já é utilizável', () => {
    const result = extractPastedFile(
      [{ kind: 'file', type: 'image/png' }],
      [],
      () => fakeFile('print-erro.png', 'image/png')
    );

    expect(result?.file.name).toBe('print-erro.png');
  });

  it('cai para `files` quando `items` não traz arquivo', () => {
    // Firefox e outros preenchem `files` em vez de `items`.
    const result = extractPastedFile(
      [{ kind: 'string', type: 'text/plain' }],
      [fakeFile('foto.jpg', 'image/jpeg')],
      () => null
    );

    expect(result?.kind).toBe('image');
    expect(result?.file.name).toBe('foto.jpg');
  });

  it('ignora item de texto e devolve null', () => {
    // Clipboard só com texto: o paste deve seguir o fluxo normal do
    // textarea, não ser consumido.
    const result = extractPastedFile(
      [{ kind: 'string', type: 'text/plain' }],
      [],
      () => null
    );
    expect(result).toBeNull();
  });

  it('ignora arquivo de tipo não suportado', () => {
    const result = extractPastedFile(
      [{ kind: 'file', type: 'image/svg+xml' }],
      [],
      () => fakeFile('x.svg', 'image/svg+xml')
    );
    expect(result).toBeNull();
  });

  it('devolve null para clipboard vazio', () => {
    expect(extractPastedFile([], [], () => null)).toBeNull();
    expect(extractPastedFile(null, null, () => null)).toBeNull();
    expect(extractPastedFile(undefined, undefined, () => null)).toBeNull();
  });

  it('escolhe o primeiro arquivo válido quando há vários', () => {
    const result = extractPastedFile(
      [
        { kind: 'string', type: 'text/plain' },
        { kind: 'file', type: 'image/png' },
        { kind: 'file', type: 'image/jpeg' },
      ],
      [],
      () => fakeFile('img.png', 'image/png')
    );
    expect(result?.kind).toBe('image');
  });
});
