'use client';

// ============================================================
// Regra de "Aguardando resposta" no painel de gestão.
//
// Equipes de suporte contínuo frequentemente não fecham conversas
// (`status = 'closed'`). Na regra padrão, qualquer conversa em que o
// cliente mandou a última mensagem ("Ok", "Obrigado", aviso automático)
// fica presa na fila do painel.
//
// Este card permite alternar por conta entre:
//   - ligado    → conta apenas conversas individuais não lidas (`unread_count > 0`)
//   - desligado → conta conversas abertas cuja última mensagem é do cliente
// ============================================================

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MailCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function WaitingRuleCard() {
  const { accountId, canEditSettings, profileLoading } = useAuth();
  const t = useTranslations('Settings.inbox.waitingRule');

  const [saved, setSaved] = useState<boolean | null>(null);
  const [draft, setDraft] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    createClient()
      .from('accounts')
      .select('waiting_only_unread')
      .eq('id', accountId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          toast.error(t('loadFailed'));
          return;
        }
        const value = data.waiting_only_unread === true;
        setSaved(value);
        setDraft(value);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, t]);

  const dirty = saved !== null && draft !== saved;

  async function handleSave() {
    if (!accountId || !dirty) return;
    setSaving(true);
    const { error } = await createClient()
      .from('accounts')
      .update({ waiting_only_unread: draft })
      .eq('id', accountId);
    setSaving(false);
    if (error) {
      toast.error(t('saveFailed'));
      return;
    }
    setSaved(draft);
    toast.success(t('saveSuccess'));
  }

  const disabled = !canEditSettings || profileLoading || saved === null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <MailCheck className="size-4 text-primary" />
          {t('title')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <Label htmlFor="waiting-only-unread" className="flex-1 text-muted-foreground">
            {draft ? t('enabledLabel') : t('disabledLabel')}
          </Label>
          <Switch
            id="waiting-only-unread"
            checked={draft}
            onCheckedChange={(v) => setDraft(!!v)}
            disabled={disabled}
            aria-label={t('title')}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          {canEditSettings ? t('hint') : t('adminOnlyHint')}
        </p>

        {canEditSettings && (
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('saving')}
              </>
            ) : (
              t('save')
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
