// ============================================================
// Colar imagem (Ctrl+V) no composer.
//
// Colar um print é o gesto mais comum no atendimento: o cliente manda um
// erro, o atendente recorta e cola. Hoje só existe o clipe, que abre o
// seletor de arquivos — três cliques onde deveria haver nenhum.
//
// Duas armadilhas que este módulo resolve, e que justificam os testes:
//
// 1. O clipboard pode conter TEXTO e imagem ao mesmo tempo (um print com o
//    texto de um lado). Se houver arquivo, ele tem precedência; se não
//    houver, o texto é colado normalmente pelo comportamento padrão do
//    textarea — e é por isso que o handler só chama `preventDefault` quando
//    decide consumir o evento.
//
// 2. `clipboardData.files` vem VAZIO em vários navegadores ao colar imagem;
//    os dados ficam em `clipboardData.items` com `kind === 'file'`. Ler só
//    `files` faria o recurso não funcionar justamente no Chrome, que é o
//    navegador usado aqui.
// ============================================================

/** Tipo de anexo que o composer sabe enviar. */
export type PickedKind = 'image' | 'video' | 'document';

/** O mínimo de um `DataTransferItem` que precisamos ler. */
export interface ClipboardItemLike {
  kind: string;
  type: string;
}

export interface ExtractedPaste {
  /** Anexo identificado, ou null quando não há arquivo no clipboard. */
  kind: PickedKind;
  /** O arquivo em si, já como `File`. */
  file: File;
}

/**
 * Classifica um tipo MIME no anexo correspondente.
 *
 * Segue as mesmas três categorias que o clipe já oferece; um tipo que não
 * caiba em nenhuma (ex.: `image/svg+xml`, que o WhatsApp recusa) devolve
 * null em vez de virar documento por engano.
 */
export function kindForMime(mime: string): PickedKind | null {
  const type = mime.toLowerCase().split(';')[0].trim();

  if (type === 'image/png' || type === 'image/jpeg' || type === 'image/webp') {
    return 'image';
  }
  if (type === 'video/mp4' || type === 'video/3gpp') return 'video';
  if (
    type === 'application/pdf' ||
    type === 'application/msword' ||
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    type === 'application/vnd.ms-excel' ||
    type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    type === 'application/vnd.ms-powerpoint' ||
    type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    type === 'text/plain'
  ) {
    return 'document';
  }
  return null;
}

/**
 * Nome de arquivo para uma imagem colada.
 *
 * Navegador costuma entregar `blob` ou `image.png` sem extensão útil, e o
 * WhatsApp mostra esse nome ao destinatário quando é documento. Aqui a
 * extensão sai do tipo MIME e o nome fica datado, o que evita uma pilha de
 * `image.png` no histórico.
 */
export function pastedFileName(mime: string, now: number = Date.now()): string {
  const type = mime.toLowerCase().split(';')[0].trim();
  const ext =
    type === 'image/png'
      ? 'png'
      : type === 'image/webp'
        ? 'webp'
        : type === 'image/jpeg'
          ? 'jpg'
          : type === 'video/mp4'
            ? 'mp4'
            : type === 'video/3gpp'
              ? '3gp'
              : 'bin';

  const stamp = new Date(now)
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);

  return `colado_${stamp}.${ext}`;
}

/**
 * Extrai um anexo do clipboard, se houver.
 *
 * Ordem deliberada: primeiro `items` (onde o Chrome coloca a imagem), só
 * depois `files` (preenchido por outros navegadores). Ler `files` primeiro
 * funcionaria no Firefox e falharia no Chrome — o inverso do navegador que
 * este time usa.
 *
 * Devolve `null` quando o clipboard não tem arquivo reconhecível, e nesse
 * caso o chamador deixa o paste seguir o fluxo normal (colar texto).
 */
export function extractPastedFile(
  items: readonly ClipboardItemLike[] | null | undefined,
  files: readonly File[] | null | undefined,
  getAsFile: (index: number) => File | null,
  now: number = Date.now()
): ExtractedPaste | null {
  // 1) `items`: é onde o Chrome entrega a imagem colada.
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== 'file') continue;

      const kind = kindForMime(item.type);
      if (!kind) continue;

      const file = getAsFile(i);
      if (!file) continue;

      // Um `File` do clipboard pode vir sem nome (ou com "blob"). Renomear
      // deixa o histórico legível e garante a extensão certa.
      const named =
        file.name && file.name !== 'blob' && file.name.includes('.')
          ? file
          : new File([file], pastedFileName(item.type, now), { type: item.type });

      return { kind, file: named };
    }
  }

  // 2) `files`: caminho alternativo, usado quando `items` não traz nada.
  if (files && files.length > 0) {
    for (const file of files) {
      const kind = kindForMime(file.type);
      if (!kind) continue;
      return { kind, file };
    }
  }

  return null;
}
