'use client';

// ============================================================
// Botão flutuante para rolar até a última mensagem da conversa.
//
// Fica ancorado no canto inferior direito da área de mensagens (acima
// do compositor) e só aparece quando há conteúdo abaixo da janela
// visível. Reage tanto à rolagem manual quanto ao crescimento tardio
// do conteúdo (imagens, vídeos, reações e templates que terminam de
// carregar depois do primeiro render).
// ============================================================

import { useCallback, useEffect, useState, type RefObject } from 'react';
import { ArrowDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  scrollElementToBottom,
  shouldShowScrollToBottom,
} from '@/adapto/inbox/scroll-to-bottom';

interface ScrollToBottomButtonProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  conversationId: string;
  messageCount: number;
  loading: boolean;
}

export function ScrollToBottomButton({
  scrollRef,
  conversationId,
  messageCount,
  loading,
}: ScrollToBottomButtonProps) {
  const t = useTranslations('Inbox.messageThread');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || loading || messageCount === 0) return;

    const update = () => {
      const next = shouldShowScrollToBottom({
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
      });
      setVisible((prev) => (prev === next ? prev : next));
    };

    const rafId = window.requestAnimationFrame(update);

    el.addEventListener('scroll', update, { passive: true });
    // `load` não borbulha, mas chega na fase de captura quando <img> ou
    // <video> termina de carregar e expande a altura da lista.
    el.addEventListener('load', update, true);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(el);
      if (el.firstElementChild) {
        observer.observe(el.firstElementChild);
      }
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      el.removeEventListener('scroll', update);
      el.removeEventListener('load', update, true);
      observer?.disconnect();
    };
  }, [scrollRef, conversationId, messageCount, loading]);

  const handleClick = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollElementToBottom(el, prefersReducedMotion ? 'auto' : 'smooth');
  }, [scrollRef]);

  if (loading || messageCount === 0 || !visible) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={t('scrollToBottom')}
      title={t('scrollToBottom')}
      className="absolute right-4 bottom-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-md backdrop-blur-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowDown className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
