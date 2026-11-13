'use client';

// ============================================================
// Barra de formatação do composer.
//
// Botões no estilo do WhatsApp Web: negrito, itálico, riscado e
// monoespaçado. Cada um aplica/toggle no texto selecionado; sem seleção,
// aplica na palavra sob o cursor.
//
// Os atalhos de teclado (Ctrl+B/I/E, Ctrl+Shift+X) NÃO são tratados aqui —
// são interceptados no `onKeyDown` do textarea (ver `message-composer.tsx`),
// porque o evento precisa existir no campo com foco.
// ============================================================

import { Bold, Italic, Strikethrough, Code, List } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { FORMATTERS, type FormatterKind } from './editing';

/** Ordem da barra. `code` por último, como no WhatsApp Web. */
const BAR: Array<{ kind: FormatterKind; icon: typeof Bold; hint: string }> = [
  { kind: 'bold', icon: Bold, hint: 'Ctrl+B' },
  { kind: 'italic', icon: Italic, hint: 'Ctrl+I' },
  { kind: 'strike', icon: Strikethrough, hint: 'Ctrl+Shift+X' },
  { kind: 'code', icon: Code, hint: 'Ctrl+E' },
];

export function FormatBar({
  onFormat,
  onList,
  disabled,
}: {
  /** Aplica o formatter no texto do composer. */
  onFormat: (kind: FormatterKind) => void;
  /** Insere/alternar item de lista na linha do cursor. */
  onList: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations('Composer.formatBar');

  return (
    <div
      className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/60 px-0.5 py-0.5"
      role="toolbar"
      aria-label={t('label')}
    >
      {BAR.map(({ kind, icon: Icon, hint }) => (
        <button
          key={kind}
          type="button"
          // `mousedown` + preventDefault preserva a seleção do textarea:
          // um `click` normal tiraria o foco e o `selectionStart/End`
          // que os atalhos usariam em seguida.
          onMouseDown={(e) => {
            e.preventDefault();
          }}
          onClick={() => onFormat(kind)}
          disabled={disabled}
          aria-label={`${FORMATTERS[kind].label} (${hint})`}
          title={`${FORMATTERS[kind].label} (${hint})`}
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors',
            'hover:bg-muted hover:text-foreground',
            'disabled:cursor-not-allowed disabled:opacity-40',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}

      {/* Lista é o caso à parte: no WhatsApp ela é TEXTO (`- item`), não
          formatação no fio — por isso não é um FormatterKind. O botão
          insere o prefixo; Enter dentro da lista continua os itens. */}
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={onList}
        disabled={disabled}
        aria-label={t('list')}
        title={t('list')}
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors',
          'hover:bg-muted hover:text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-40',
        )}
      >
        <List className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
