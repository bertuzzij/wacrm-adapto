'use client';

// ============================================================
// Seletor segmentado de filtro por nome (Todos / Com nome / Só número).
// ============================================================

import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import {
  CONTACT_NAME_FILTERS,
  type ContactNameFilter,
} from '@/adapto/contacts/name-filter';

interface ContactNameFilterBarProps {
  value: ContactNameFilter;
  onChange: (next: ContactNameFilter) => void;
}

const LABEL_KEY: Record<ContactNameFilter, 'all' | 'named' | 'phoneOnly'> = {
  all: 'all',
  named: 'named',
  phone_only: 'phoneOnly',
};

export function ContactNameFilterBar({
  value,
  onChange,
}: ContactNameFilterBarProps) {
  const t = useTranslations('Contacts.page.nameFilter');

  return (
    <div
      role="group"
      aria-label={t('label')}
      className="inline-flex h-9 shrink-0 items-center rounded-md border border-border bg-card p-0.5"
    >
      {CONTACT_NAME_FILTERS.map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={cn(
              'h-full rounded-sm px-2.5 text-xs font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t(LABEL_KEY[option])}
          </button>
        );
      })}
    </div>
  );
}
