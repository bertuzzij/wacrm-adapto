'use client';

// ============================================================
// Bolha de vídeo com play SOB DEMANDA.
//
// Substitui `MediaVideoBubble` do upstream, que monta um `<video>` com o
// `src` já preenchido. Isso obriga o navegador a buscar bytes do arquivo
// só por a conversa estar aberta, e no nosso caminho cada byte passa pela
// RAM do servidor (o proxy não repassa `Range`).
//
// Aqui a bolha não busca nada. Ela desenha um cartão — ícone, "Vídeo" e o
// tamanho quando conhecido — com dois botões:
//
//   [▶ Assistir]  cria o `<video>` naquele instante e só então busca
//   [↓ Baixar]    baixa o arquivo direto, sem tocar no player
//
// O estado de "ainda não pedi" é o inicial, e é o que evita o custo. Uma
// vez pedido, o player aparece e o usuário pode fechá-lo (volta ao cartão,
// liberando o buffer).
//
// Quando o arquivo é grande demais para valer a espera (`download-only`,
// ver `decision.ts`), só o download é oferecido: um play que trava a tela
// é pior que a ausência dele.
// ============================================================

import { useState } from 'react';
import { Download, Film, Loader2, Maximize2, Play, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { Message } from '@/types';
import { downloadMediaMessage } from '@/lib/media/download';
import {
  videoCardSubtitle,
  videoPresentation,
} from '@/adapto/video-playback/decision';

/** Mesmo teto das outras bolhas, para a lista não ficar irregular. */
const MEDIA_BOX = 'max-h-64 max-w-60';

export function LazyVideoBubble({
  message,
  onOpen,
  t,
}: {
  message: Message;
  /** Abre o visualizador da conversa. Omitido ⇒ sem botão de expandir. */
  onOpen?: () => void;
  /** Tradutor do inbox (o mesmo que as outras bolhas recebem). */
  t: ReturnType<typeof useTranslations>;
}) {
  const tVideo = useTranslations('Inbox.videoCard');
  const [playing, setPlaying] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Tamanho do arquivo, quando o payload o trouxe. A coluna não existe no
  // schema (nenhuma migração guardou isso), então na prática vem null para
  // todo o acervo atual — e o módulo de decisão já trata "desconhecido"
  // como tocável, em vez de recusar o player.
  // A leitura é defensiva para não quebrar se o campo aparecer depois.
  const raw = (message as { media_size?: unknown }).media_size;
  const bytes = typeof raw === 'number' ? raw : null;
  const presentation = videoPresentation(bytes);
  const subtitle = videoCardSubtitle(bytes, {
    large: tVideo('large'),
    video: tVideo('label'),
  });

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadMediaMessage(message);
    } catch {
      toast.error(t('downloadFailed'));
    } finally {
      setDownloading(false);
    }
  };

  // Player montado só depois do pedido. A partir daqui o navegador busca
  // bytes — e é exatamente o que o usuário autorizou ao clicar.
  if (playing) {
    return (
      <div className="relative w-fit">
        <video
          src={message.media_url}
          controls
          autoPlay
          playsInline
          preload="metadata"
          className={cn(MEDIA_BOX, 'rounded-lg')}
        />
        <button
          type="button"
          onClick={() => setPlaying(false)}
          aria-label={tVideo('close')}
          title={tVideo('close')}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-background/85 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex w-60 items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5',
        'ring-1 ring-inset ring-border/40'
      )}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15"
        aria-hidden
      >
        <Film className="h-4 w-4 text-primary" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {tVideo('label')}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {subtitle}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-1">
        {presentation === 'card' && (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={tVideo('play')}
            title={tVideo('play')}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
        {/* Expandir reaproveita o visualizador da conversa, que já navega
            entre os anexos. Continua sob demanda: o lightbox monta o
            `<video>` só quando aberto. */}
        {onOpen && presentation === 'card' && (
          <button
            type="button"
            onClick={onOpen}
            aria-label={t('expandVideo')}
            title={t('expandVideo')}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-background text-foreground transition-colors hover:bg-muted"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={download}
          disabled={downloading}
          aria-label={t('download')}
          title={t('download')}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-background text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </button>
      </span>
    </div>
  );
}
