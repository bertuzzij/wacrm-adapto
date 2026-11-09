'use client';

// ============================================================
// Botão de menção (@) para conversas de grupo.
//
// O WhatsApp menciona por TELEFONE. O nome que o cliente vê é o que ele
// tem salvo na própria agenda — não o nosso. Então a lista mostra nome +
// telefone (para o atendente reconhecer), mas o que entra no texto é
// `@5516…`.
//
// A lista vem do WAHA pelo servidor, nunca do navegador: a chave da API
// não pode chegar ao cliente.
//
// Só aparece em grupo. Numa conversa individual não há quem mencionar —
// a outra pessoa já é a conversa.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { AtSign, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { GroupMember } from '@/adapto/whatsapp-groups/members';

export interface MentionButtonProps {
  conversationId: string;
  /** Recebe o telefone escolhido; o composer insere `@telefone ` no cursor. */
  onPick: (phone: string) => void;
  disabled?: boolean;
}

export function MentionButton({
  conversationId,
  onPick,
  disabled,
}: MentionButtonProps) {
  const t = useTranslations('Inbox.mentions');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Troca de conversa: a lista anterior não vale mais.
  //
  // BUG RELATADO: "quando eu mudo de chat ainda carrega a menção do chat
  // anterior, aí eu preciso selecionar uma conversa com um usuário para ele
  // 'limpar'". Causa: o efeito abaixo tinha `members.length > 0` como guarda
  // de "já carreguei", e `members` nunca era esvaziado. Ao abrir um segundo
  // grupo, a guarda via lista cheia e pulava a busca — mostrando os membros
  // do grupo anterior. Só uma conversa individual (que devolve lista vazia)
  // zerava o estado.
  //
  // `key` não resolve: o componente não é remontado ao trocar de conversa,
  // porque o React o reutiliza na mesma posição da árvore. O reset precisa
  // ser explícito, e tem de acontecer no MESMO passo em que a conversa muda
  // — resetar num efeito separado deixaria um render mostrando a lista
  // velha sob o cabeçalho novo.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (loadedFor !== conversationId) {
    setLoadedFor(conversationId);
    setMembers([]);
    setQuery('');
    setLoading(false);
  }

  // Busca ao abrir, não no mount: a maioria das mensagens não menciona
  // ninguém, e uma chamada por conversa aberta seria desperdício.
  //
  // `setLoading(true)` NÃO fica aqui: a regra `react-hooks/set-state-in-effect`
  // (eslint-plugin-react-hooks v7) acusa setState síncrono no corpo do efeito
  // porque ele provoca um render em cascata imediatamente após a pintura.
  // Ele foi movido para o clique que abre o painel — que é onde a intenção
  // do usuário nasce, e uma atualização de estado em handler de evento é
  // exatamente o lugar certo para isso.
  useEffect(() => {
    if (!open || members.length > 0) return;
    let cancelled = false;
    fetch(`/api/adapto/conversations/${conversationId}/members`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((data: { members?: GroupMember[] }) => {
        if (!cancelled) setMembers(data.members ?? []);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, conversationId, members.length]);

  /** Abre/fecha o painel; marca o carregamento no clique, não no efeito. */
  const toggleOpen = () => {
    const willOpen = !open;
    setOpen(willOpen);
    // Só ao abrir, e só se ainda não temos a lista em mãos. Fora do
    // updater de `setOpen` de propósito: o updater precisa ser puro.
    if (willOpen && members.length === 0) setLoading(true);
  };

  // Fecha ao clicar fora e no Escape, como o seletor de emoji.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handlePick = useCallback(
    (phone: string) => {
      onPick(phone);
      setOpen(false);
      setQuery('');
    },
    [onPick]
  );

  const filtered = members.filter((m) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      m.phone.includes(q) ||
      m.waId.toLowerCase().includes(q)
    );
  });

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        aria-label={t('open')}
        aria-expanded={open}
        title={t('open')}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
          'hover:bg-muted hover:text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        <AtSign className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          <div className="border-b border-border p-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search')}
              autoFocus
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                {members.length === 0 ? t('empty') : t('noMatch')}
              </p>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.waId || m.phone}
                  type="button"
                  onClick={() => handlePick(m.phone)}
                  // Membro sem telefone não é mencionável: o WhatsApp
                  // menciona por número e um LID não serve. Fica visível
                  // (saber quem está no grupo é útil) mas desabilitado.
                  disabled={!m.phone}
                  title={!m.phone ? t('noPhone') : undefined}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-medium text-foreground">
                    {m.avatarUrl ? (
                      <img
                        src={m.avatarUrl}
                        alt=""
                        // A foto vem de `pps.whatsapp.net` e expira em ~2
                        // dias; falha aqui cai nas iniciais em vez de
                        // deixar um quadrado quebrado na lista.
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                        className="h-7 w-7 rounded-full object-cover"
                      />
                    ) : (
                      (m.name || m.phone || m.waId).charAt(0).toUpperCase()
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {m.name || m.phone || t('noName')}
                      {m.isAdmin && (
                        <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          {t('admin')}
                        </span>
                      )}
                    </span>
                    {/* O telefone fica visível porque é ele que será
                        mencionado — o nome que o cliente vê é o da agenda
                        dele, não o nosso. */}
                    {m.name && m.phone && (
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {m.phone}
                      </span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
