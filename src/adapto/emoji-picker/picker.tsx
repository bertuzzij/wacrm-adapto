'use client';

// ============================================================
// Botão de emoji do composer.
//
// O upstream evitou uma biblioteca de emoji de propósito, para não pagar
// ~300 KB no carregamento da inbox (comentário em message-actions.tsx).
// Aqui o peso continua zero até o primeiro clique: o picker entra por
// `next/dynamic` com `ssr: false`, então o bundle só é baixado quando o
// usuário pede o seletor.
//
// `emojiStyle: 'native'` é deliberado. Os outros estilos renderizam PNGs
// de `cdn.jsdelivr.net`, o que adicionaria uma origem externa à CSP e uma
// dependência de rede para desenhar um caractere. O estilo nativo usa a
// fonte de emoji do sistema — que no desktop do cliente é a do próprio
// Windows/WhatsApp.
// ============================================================

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { Smile, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';
import { localizedCategories } from './emoji-data';

// Só é baixado quando o popover abre. O `loading` aparece por milissegundos
// em rede boa, mas evita um popover vazio em conexão lenta.
const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[350px] w-[320px] items-center justify-center text-sm text-muted-foreground">
      <span className="animate-pulse">…</span>
    </div>
  ),
});

export interface EmojiButtonProps {
  /** Recebe o emoji escolhido; o composer decide onde ele entra. */
  onPick: (emoji: string) => void;
  /** Desabilita o botão (papel somente-leitura, janela fechada). */
  disabled?: boolean;
}

export function EmojiButton({ onPick, disabled }: EmojiButtonProps) {
  const t = useTranslations('Inbox.emojiPicker');
  const locale = useLocale();
  const { mode } = useTheme();

  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora e no Escape. Sem isso o popover fica aberto por
  // cima da conversa e o usuário precisa achar o botão de novo.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-label={t('open')}
        aria-expanded={open}
        title={t('open')}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
          'hover:bg-muted hover:text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        <Smile className="h-4 w-4" />
      </button>

      {open && (
        <div
          className={cn(
            'absolute bottom-full left-0 z-50 mb-2 overflow-hidden rounded-lg border border-border',
            'bg-card shadow-lg',
            // O picker traz CSS próprio com cores fixas; estas variáveis
            // alinham fundo/borda ao tema do CRM nos dois modos.
            '[&_.epr-main]:!border-0 [&_.epr-main]:!bg-transparent'
          )}
        >
          <div className="flex justify-end border-b border-border px-2 py-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('close')}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <EmojiPicker
            onEmojiClick={(data) => onPick(data.emoji)}
            theme={mode === 'dark' ? 'dark' : 'light'}
            emojiStyle="native"
            categories={localizedCategories(locale)}
            searchPlaceHolder={t('search')}
            searchClearButtonLabel={t('clear')}
            previewConfig={{ showPreview: false }}
            lazyLoadEmojis
            skinTonesDisabled={false}
            width={320}
            height={350}
          />
        </div>
      )}
    </div>
  );
}
