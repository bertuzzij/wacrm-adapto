'use client';

// ============================================================
// Botão "Gerar Conversa" reutilizável (usado nos detalhes do contato).
//
// Chama `/api/adapto/conversations/start`, que reaproveita a conversa
// existente do contato (reabrindo se fechada) ou cria uma nova aberta,
// e leva direto para `/inbox?c=<id>`.
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MessageSquarePlus } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { useCan } from '@/hooks/use-can';
import {
  inboxConversationHref,
  requestStartConversation,
} from '@/adapto/inbox/start-conversation';

interface StartConversationButtonProps {
  contactId: string;
  onStarted?: () => void;
}

export function StartConversationButton({
  contactId,
  onStarted,
}: StartConversationButtonProps) {
  const t = useTranslations('Contacts.detailView');
  const router = useRouter();
  const canSend = useCan('send-messages');
  const [starting, setStarting] = useState(false);

  if (!canSend) return null;

  async function handleClick() {
    if (starting) return;
    setStarting(true);
    try {
      const { conversationId } = await requestStartConversation(contactId);
      onStarted?.();
      router.push(inboxConversationHref(conversationId));
    } catch {
      toast.error(t('toastStartConversationFailed'));
    } finally {
      setStarting(false);
    }
  }

  return (
    <Button
      size="sm"
      onClick={() => void handleClick()}
      disabled={starting}
      className="bg-primary text-primary-foreground hover:bg-primary/90"
    >
      {starting ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <MessageSquarePlus className="size-4" />
      )}
      {t('startConversationBtn')}
    </Button>
  );
}
