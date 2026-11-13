'use client';

// ============================================================
// Pré-visualização da mensagem enquanto digita.
//
// Mostra em cima do composer exatamente como a bolha vai renderizar — o
// mesmo `WhatsAppText` que o message-bubble usa. O ponto é ver os
// marcadores virarem estilo ANTES de enviar.
//
// Por que um preview e não formatação rica no textarea: um textarea não
// renderiza estilos; contentEditable traria e-mails cheios de spans
// colados na colagem, e o texto no banco tem de continuar sendo o fio
// cru do WhatsApp (`*negrito*`). O preview dá a visão sem custar o
// pipeline.
// ============================================================

import { useMemo } from 'react';
import { Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { WhatsAppText } from '@/lib/inbox/whatsapp-format';

export function MessagePreview({ text }: { text: string }) {
  const t = useTranslations('Composer.preview');

  // Só quando há marcador no texto: sem ele o preview repete o que o
  // próprio campo já mostra, ocupando espaço à toa.
  const hasFormatting = useMemo(
    () => /[*_~`]|^>\s?/m.test(text),
    [text],
  );

  if (!hasFormatting) return null;

  return (
    <div
      aria-label={t('label')}
      className="mb-1 rounded-lg border border-border/60 bg-muted/40 px-3 py-2"
    >
      <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Eye className="h-3 w-3" />
        {t('label')}
      </div>
      <div className="whitespace-pre-wrap break-words text-sm text-foreground">
        <WhatsAppText text={text} isAgent />
      </div>
    </div>
  );
}
