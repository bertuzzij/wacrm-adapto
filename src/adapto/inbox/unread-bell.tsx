'use client';

// ============================================================
// Sino de mensagens não lidas, no cabeçalho.
//
// Por que existe: o aviso de mensagem nova tinha dois problemas de
// apresentação. O ponto do menu lateral se escondia quando a seção estava
// ativa, e o toast some em poucos segundos — quem não estava olhando na
// hora exata não via nada. Ficava faltando um indicador PERSISTENTE e
// visível de dentro do próprio inbox.
//
// Este componente não abre canal de realtime próprio: recebe a contagem
// por prop, vinda do `useTotalUnread()` que o shell já mantém. Uma
// segunda subscription em `conversations` dobraria o tráfego e poderia
// divergir da primeira.
// ============================================================

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { bellHref, formatUnreadBadge } from '@/adapto/inbox/unread-summary';
import { cn } from '@/lib/utils';

export function UnreadBell({ total }: { total: number }) {
  const t = useTranslations('Header');
  const badge = formatUnreadBadge(total);

  return (
    <Link
      href={bellHref()}
      aria-label={t('unreadMessages', { count: total })}
      title={t('unreadMessages', { count: total })}
      className={cn(
        // 40×40 no mobile para o alvo do dedo; o cabeçalho já usa h-10 no
        // hamburger e no avatar, então a altura bate.
        'relative flex h-10 w-10 items-center justify-center rounded-md',
        'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        'focus:bg-muted focus:text-foreground focus:outline-none',
        // Sem não-lidas o sino continua clicável (leva ao inbox), mas
        // discreto: não compete com o toggle de tema nem com o avatar.
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
    </Link>
  );
}
