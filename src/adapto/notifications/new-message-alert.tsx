'use client';

// ============================================================
// Aviso de mensagem nova, em qualquer página.
//
// Havia dois avisos e cada um cobria metade do problema:
//
//   - o toast e o título da aba moravam em `inbox/page.tsx`, então só
//     existiam para quem já estava NA inbox. Em Configurações, Contatos ou
//     Pipelines, nada aparecia;
//   - a notificação do sistema depende de permissão do navegador, que
//     pode estar negada ou simplesmente não ter sido pedida.
//
// Este componente fecha a lacuna: assina `messages` uma vez, no shell, e
// dispara o toast em qualquer tela. A notificação do sistema continua no
// `useBrowserNotifications` — são canais independentes, e um não deve
// depender do outro.
//
// Decisões:
//
//   - Só mensagem de CLIENTE. O eco das nossas chega como INSERT também
//     (o webhook grava as enviadas); avisar "nova mensagem" de algo que o
//     próprio agente acabou de mandar seria ruído.
//   - Nada quando a aba está visível E a conversa já está aberta na tela:
//     o texto já apareceu no thread.
//   - Canal com nome único por instância. supabase-js deduplica por nome e
//     devolve o MESMO objeto; um segundo `.on()` depois de `subscribe()`
//     derruba a página. É o mesmo problema já pago em use-total-unread.
// ============================================================

import { useEffect, useId, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { shouldNotifyForMessage, viewedConversationFromLocation } from '@/lib/notifications/browser-notify';
import type { Message } from '@/types';

export function NewMessageAlert() {
  const router = useRouter();
  const t = useTranslations('Inbox.page');
  const channelSuffix = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  // Dedupe por id, igual ao listener de notificação: o Realtime pode
  // reentregar o mesmo evento numa reconexão.
  const seenRef = useRef<Map<string, number>>(new Map());
  // Evita um burst ao voltar de uma desconexão longa: só avisa de mensagem
  // realmente recente (o atraso máximo tolerado é este).
  //
  // Inicializado com `null` e preenchido no efeito: `useRef(Date.now())`
  // avalia o argumento a CADA render (é só um valor inicial, não uma
  // fábrica), o que a regra `react-hooks/purity` do
  // eslint-plugin-react-hooks v7 acusa como função impura durante o
  // render. `Date.now()` é impuro por definição — muda sem o React saber.
  const mountedAtRef = useRef<number | null>(null);

  useEffect(() => {
    // Marca o instante real do mount. É aqui, e não no render, que ler o
    // relógio faz sentido.
    const mountedAt = Date.now();
    mountedAtRef.current ??= mountedAt;
    const supabase = createClient();
    let cancelled = false;

    const channel = supabase
      .channel(`new-message-alert-${channelSuffix}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as Message;

          const should = shouldNotifyForMessage(msg, {
            documentVisible: document.visibilityState === 'visible',
            viewingConversationId: viewedConversationFromLocation(
              window.location.pathname,
              window.location.search
            ),
            seen: seenRef.current,
          });
          if (!should) return;

          // Não avisa de mensagem anterior ao mount: numa reconexão o
          // Realtime pode entregar eventos atrasados, e uma enxurrada de
          // toasts de mensagens lidas horas atrás é pior que nenhum.
          const createdAt = new Date(msg.created_at).getTime();
          const mountedAt = mountedAtRef.current ?? Date.now();
          if (Number.isFinite(createdAt) && createdAt < mountedAt - 60_000) {
            return;
          }

          void (async () => {
            const { data } = await supabase
              .from('conversations')
              .select('contact:contacts(name, wa_username, phone)')
              .eq('id', msg.conversation_id)
              .maybeSingle();
            if (cancelled) return;

            const contact = (data as {
              contact?: {
                name?: string | null;
                wa_username?: string | null;
                phone?: string | null;
              } | null;
            } | null)?.contact;

            const name =
              contact?.name?.trim() ||
              contact?.wa_username?.trim() ||
              contact?.phone?.trim() ||
              t('newMessageGenericSender');

            toast(t('newMessageToast', { name }), {
              description: (msg.content_text ?? '').slice(0, 90),
              action: {
                label: t('newMessageOpen'),
                onClick: () => {
                  router.push(`/inbox?c=${msg.conversation_id}`, {
                    scroll: false,
                  });
                },
              },
            });
          })();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [router, channelSuffix, t]);

  return null;
}
