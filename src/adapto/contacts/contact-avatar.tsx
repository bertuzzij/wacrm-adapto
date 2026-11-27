'use client';

// ============================================================
// Avatar do contato na tabela de Contatos.
//
// Usa a foto já sincronizada em `contacts.avatar_url` (Storage) e cai
// automaticamente para as iniciais do nome real ou um ícone discreto
// quando o contato só tem o número salvo (ou quando a imagem falha).
// ============================================================

import { User } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { contactInitials } from '@/adapto/contacts/name-filter';

interface ContactAvatarProps {
  name?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
}

export function ContactAvatar({ name, phone, avatarUrl }: ContactAvatarProps) {
  const initials = contactInitials(name);
  const alt = name?.trim() || phone?.trim() || '';

  return (
    <Avatar className="size-8 border border-border bg-muted">
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={alt} /> : null}
      <AvatarFallback className="bg-muted text-[11px] font-medium text-muted-foreground">
        {initials ?? <User className="size-3.5" aria-hidden="true" />}
      </AvatarFallback>
    </Avatar>
  );
}
