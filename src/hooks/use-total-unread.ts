"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/paged-query";
import { applyUnreadChange, type UnreadChange } from "@/lib/inbox/unread-set";

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Used by the sidebar to surface a green dot on the
 * Inbox nav entry when the user is elsewhere in the app.
 *
 * Lives on its own realtime channel (distinct from the inbox page's
 * "inbox-realtime") so both can coexist without sharing state.
 *
 * IMPORTANT — the channel name must be unique per hook instance.
 * supabase-js dedupes channels by name and hands back the SAME channel
 * object for a repeated name, so a second mount would call `.on()` on an
 * already-subscribed channel and throw:
 *
 *   cannot add `postgres_changes` callbacks for <name> after `subscribe()`
 *
 * That is exactly what broke the dashboard when a second consumer of this
 * hook appeared: the channel name was a constant, the second mount found
 * the first one's channel, and the whole page failed to render. `useId`
 * gives each instance its own channel, so any number of consumers — and
 * React StrictMode's double-mount in dev — stay independent.
 *
 * Inside the dashboard prefer the shared value from
 * `<UnreadCountProvider>` over calling this hook a second time: one
 * subscription is enough, and this uniqueness guarantee is a safety net,
 * not an invitation to mount it repeatedly.
 */
export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);
  // Sanitised because React ids look like ":r0:" and a colon has no
  // business being in a channel name.
  const channelName = `total-unread-realtime-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const unreadIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    // Initial load. RLS scopes this to the signed-in user automatically —
    // no explicit user_id filter needed here.
    (async () => {
      let rows: { id: string }[];
      try {
        rows = await fetchAllPages<{ id: string }>((from, to) =>
          supabase
            .from("conversations")
            .select("id")
            .gt("unread_count", 0)
            .order("id")
            .range(from, to),
        );
      } catch {
        return;
      }
      if (cancelled) return;
      const unreadIds = unreadIdsRef.current;
      for (const row of rows) unreadIds.add(row.id);
      setTotal(unreadIds.size);
    })();

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          const unreadIds = unreadIdsRef.current;
          applyUnreadChange(unreadIds, payload as unknown as UnreadChange);
          setTotal(unreadIds.size);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [channelName]);

  return total;
}
