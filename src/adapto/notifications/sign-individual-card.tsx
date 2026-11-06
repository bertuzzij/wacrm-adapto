'use client';

// ============================================================
// Assinatura do atendente em conversa individual.
//
// Decide o texto que o CLIENTE recebe, então é configuração da conta (com
// `accounts.sign_individual_messages`) e não preferência de navegador — dois
// atendentes com escolhas diferentes mandariam mensagens assinadas e não
// assinadas para o mesmo cliente no mesmo dia.
//
// Em grupo não há escolha: a assinatura é sempre aplicada, porque o
// protocolo não carrega autor nenhum.
// ============================================================

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AtSign, Loader2 } from 'lucide-react';
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

export function SignIndividualCard() {
  const { accountId, canEditSettings, profileLoading } = useAuth();
  const t = useTranslations('Settings.notifications');

  const [saved, setSaved] = useState<boolean | null>(null);
  const [draft, setDraft] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    createClient()
      .from('accounts')
      .select('sign_individual_messages')
      .eq('id', accountId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          toast.error(t('loadFailed'));
          return;
        }
        const value = data.sign_individual_messages === true;
        setSaved(value);
        setDraft(value);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, t]);

  const dirty = saved !== null && draft !== saved;
  const disabled = !canEditSettings || profileLoading || saved === null;

  async function handleSave() {
    if (!accountId || !dirty) return;
    setSaving(true);
    const { error } = await createClient()
      .from('accounts')
      .update({ sign_individual_messages: draft })
      .eq('id', accountId);
    setSaving(false);
    if (error) {
      toast.error(t('saveFailed'));
      return;
    }
    setSaved(draft);
    toast.success(t('saveSuccess'));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <AtSign className="size-4 text-primary" />
          {t('signTitle')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('signDesc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <Label htmlFor="sign-individual" className="flex-1 text-muted-foreground">
            {draft ? t('signOn') : t('signOff')}
          </Label>
          <Switch
            id="sign-individual"
            checked={draft}
            onCheckedChange={(v) => setDraft(!!v)}
            disabled={disabled}
            aria-label={t('signTitle')}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          {canEditSettings ? t('signHint') : t('adminOnlyHint')}
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
