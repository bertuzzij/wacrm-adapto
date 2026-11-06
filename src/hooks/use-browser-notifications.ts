"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import type { Message } from "@/types";
import {
  DEFAULT_NOTIFICATION_LABELS,
  buildNotificationContent,
  conversationHref,
  getNotificationPermission,
  pickContactDisplayName,
  readBrowserNotifyPref,
  shouldNotifyForMessage,
  subscribeBrowserNotifyPref,
  viewedConversationFromLocation,
  type NotificationLabels,
} from "@/lib/notifications/browser-notify";
import {
  playNotificationSound,
  primeAudio,
  readSoundPref,
} from "@/adapto/notifications/sound";

const serverSnapshot = () => false;

/**
 * The device-scoped "browser notifications" opt-in, kept in sync with
 * localStorage across this tab (settings toggle) and other tabs.
 */
export function useBrowserNotifyPref(): boolean {
  return useSyncExternalStore(
    subscribeBrowserNotifyPref,
    readBrowserNotifyPref,
    serverSnapshot,
  );
}

/**
 * Desktop notifications for new inbound customer messages. Mount ONCE
 * per signed-in dashboard tab (the dashboard shell does this via
 * <BrowserNotificationsListener />) so alerts fire on any page.
 *
 * Listens for realtime INSERTs on `messages` — RLS scopes the stream to
 * the caller's account, same as useTotalUnread / useRealtime. Only
 * live events are considered: there is no initial fetch, so an existing
 * backlog never produces a burst of alerts on page load.
 *
 * Own channel name so it coexists with the inbox page's subscription
 * and the sidebar's unread counters.
 *
 * Fires only while a dashboard tab is open — there is no service worker
 * or Web Push here, so a closed browser stays quiet.
 */
export function useBrowserNotifications(): void {
  const enabled = useBrowserNotifyPref();
  const router = useRouter();
  const t = useTranslations("Settings.browserNotifications.labels");
  const channelSuffix = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  // Translated labels, read inside the async Realtime callback. Kept in
  // a ref (assigned in an effect, not during render) so a locale change
  // doesn't tear down and re-open the channel.
  const labelsRef = useRef<NotificationLabels>(DEFAULT_NOTIFICATION_LABELS);
  useEffect(() => {
    labelsRef.current = {
      fallbackTitle: t("fallbackTitle"),
      image: t("image"),
      audio: t("audio"),
      video: t("video"),
      document: t("document"),
      location: t("location"),
      template: t("template"),
    };
  });

  // Message ids already handled, for replay dedupe. Survives re-renders,
  // pruned by shouldNotifyForMessage.
  const seenRef = useRef<Map<string, number>>(new Map());

  // Destrava o áudio no primeiro gesto do usuário.
  //
  // O navegador mantém o AudioContext suspenso até um clique ou tecla real,
  // e um som disparado antes disso toca mudo. Registrar isto uma vez, no
  // início da sessão, é o que garante que o PRIMEIRO aviso já tenha som.
  // `once: true` porque depois do primeiro gesto o contexto fica liberado.
  useEffect(() => {
    // Sem gate de `enabled`: o áudio é independente do opt-in de
    // notificação. Amarrar os dois fazia o som nunca destravar para quem
    // só queria o aviso sonoro.
    const unlock = () => primeAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    // `unsupported` não impede o som: são recursos independentes. O que
    // NÃO pode acontecer é o som depender do opt-in de notificação —
    // `enabled` é a preferência de NOTIFICAÇÃO, não de áudio. Amarrar os
    // dois foi o que deixou a caixa de entrada muda para quem só queria
    // o aviso sonoro (o usuário ligava o som e nada acontecia, porque o
    // switch de notificação continuava desligado).

    const supabase = createClient();
    let cancelled = false;

    const notify = async (msg: Message) => {
      // One small select to put the contact's name in the title. A
      // failure here just means the generic fallback title.
      const { data } = await supabase
        .from("conversations")
        .select("contact:contacts(name, wa_username, phone)")
        .eq("id", msg.conversation_id)
        .maybeSingle();
      if (cancelled) return;

      const contact = (data as {
        contact?: { name?: string | null; wa_username?: string | null; phone?: string | null } | null;
      } | null)?.contact;
      const { title, body } = buildNotificationContent(
        msg,
        pickContactDisplayName(contact),
        labelsRef.current,
      );

      try {
        const notification = new Notification(title, {
          body,
          // One alert per conversation: a second message from the same
          // customer replaces the first instead of stacking.
          tag: msg.conversation_id,
          icon: "/icon",
        });
        notification.onclick = () => {
          window.focus();
          router.push(conversationHref(msg.conversation_id));
          notification.close();
        };
      } catch (err) {
        // Some browsers throw from the constructor (e.g. Android Chrome
        // requires a service worker). Non-fatal.
        console.error("[useBrowserNotifications] failed to show:", err);
      }
    };

    const channel = supabase
      // Nome único por instância: supabase-js deduplica canais por nome e
      // devolve o MESMO objeto, então um segundo mount cairia no erro
      // "cannot add postgres_changes callbacks after subscribe()". É o
      // mesmo bug que derrubou o dashboard em use-total-unread.ts.
      .channel(`browser-notifications-${channelSuffix}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          const shouldNotify = shouldNotifyForMessage(msg, {
            documentVisible: document.visibilityState === "visible",
            viewingConversationId: viewedConversationFromLocation(
              window.location.pathname,
              window.location.search,
            ),
            seen: seenRef.current,
          });
          if (!shouldNotify) return;

          // Som: preferência própria, independente do switch de notificação.
          if (readSoundPref()) playNotificationSound();

          // Notificação do sistema: exige o opt-in E a permissão do
          // navegador. Re-checada a cada evento porque o usuário pode
          // revogar a permissão sem o switch mudar.
          if (!enabled) return;
          if (getNotificationPermission() !== "granted") return;
          void notify(msg);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [enabled, router, channelSuffix]);
}
