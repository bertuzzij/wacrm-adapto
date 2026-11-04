'use client';

// ============================================================
// Sino de avisos do cabeçalho.
//
// Junta duas origens com significados diferentes:
//
//   inbox       — conversa com mensagem do cliente esperando resposta
//   atribuição  — alguém te passou uma conversa
//
// O badge mostra o total; o painel abre em seções separadas, porque as
// duas pedem ações diferentes. Um número somado sozinho esconderia a
// diferença.
//
// Não abre canal de realtime: as contagens vêm do <UnreadCountProvider>
// do shell, que mantém uma subscription por tabela.
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Inbox as InboxIcon, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  bellSections,
  bellTotal,
  formatUnreadBadge,
  type BellSource,
} from '@/adapto/inbox/unread-summary';
import { useBellCounts } from '@/adapto/inbox/unread-count-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const SOURCE_ICON = {
  inbox: InboxIcon,
  assignment: UserPlus,
} as const;

const SOURCE_LABEL_KEY: Record<BellSource, string> = {
  inbox: 'bell.inbox',
  assignment: 'bell.assignment',
};

const SOURCE_HINT_KEY: Record<BellSource, string> = {
  inbox: 'bell.inboxHint',
  assignment: 'bell.assignmentHint',
};

export function UnreadBell() {
  const t = useTranslations('Header');
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const counts = useBellCounts();
  const sections = bellSections(counts);
  const total = bellTotal(counts);
  const badge = formatUnreadBadge(total);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={t('unreadMessages', { count: total })}
        title={t('unreadMessages', { count: total })}
        className={cn(
          // 40×40 no mobile para o alvo do dedo; casa com o hamburger e
          // com o avatar do cabeçalho.
          'relative flex h-10 w-10 items-center justify-center rounded-md',
          'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          'focus:bg-muted focus:text-foreground focus:outline-none',
          // Sem nada pendente continua clicável (leva ao inbox), mas
          // discreto: não disputa atenção com o tema nem com o avatar.
          badge === null && 'opacity-70 hover:opacity-100',
        )}
      >
        <Bell className="h-5 w-5" />
        {badge !== null ? (
          <span
            aria-hidden="true"
            className={cn(
              'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center',
              'rounded-full bg-primary px-1 text-[10px] font-bold leading-none',
              'text-primary-foreground ring-2 ring-background',
            )}
          >
            {badge}
          </span>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-72 bg-popover p-2 text-popover-foreground ring-border"
      >
        {sections.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            {t('bell.empty')}
          </p>
        ) : (
          <ul className="space-y-1">
            {sections.map((section) => {
              const Icon = SOURCE_ICON[section.source];
              return (
                <li key={section.source}>
                  <button
                    type="button"
                    onClick={() => go(section.href)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left',
                      'transition-colors hover:bg-muted focus:bg-muted focus:outline-none',
                    )}
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15"
                      aria-hidden
                    >
                      <Icon className="h-4 w-4 text-primary" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {t(SOURCE_LABEL_KEY[section.source])}
                        </span>
                        <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                          {section.count}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {t(SOURCE_HINT_KEY[section.source])}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
