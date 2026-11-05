'use client';

// ============================================================
// Interruptor da janela de mensagens de 24 horas.
//
// A regra de 24h é da API oficial da Meta. Quem fala por WAHA não tem
// essa restrição, mas o CRM aplicava a regra de qualquer jeito e travava
// o compositor. Este painel dá o controle — e o texto de apoio avisa que
// desligar não convence a Meta de nada: se a conta usa a API oficial, é
// ela que recusa o envio fora da janela.
// ============================================================

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Timer } from 'lucide-react';
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
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import { invalidateMessagingWindow } from './use-messaging-window';

export function MessagingWindowPanel() {
  const { accountId, canEditSettings, profileLoading } = useAuth();
  const t = useTranslations('Settings.messagingWindow');

  const [saved, setSaved] = useState<boolean | null>(null);
  const [draft, setDraft] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    createClient()
      .from('accounts')
      .select('enforce_messaging_window')
      .eq('id', accountId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          toast.error(t('loadFailed'));
          return;
        }
        // Ausente = conta criada antes da migração 062, e o padrão é ligado.
        const value = data.enforce_messaging_window !== false;
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
      .update({ enforce_messaging_window: draft })
      .eq('id', accountId);
    setSaving(false);
    if (error) {
      toast.error(t('saveFailed'));
      return;
    }
    // O compositor e o filtro da inbox leem do cache; sem invalidar,
    // a mudança só apareceria depois do TTL.
    invalidateMessagingWindow(accountId);
    setSaved(draft);
    toast.success(t('saveSuccess'));
  }

  const disabled = !canEditSettings || profileLoading || saved === null;

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Timer className="size-4 text-primary" />
            {t('windowLabel')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('windowDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <Label htmlFor="enforce-window" className="flex-1 text-muted-foreground">
              {draft ? t('enabledLabel') : t('disabledLabel')}
            </Label>
            <Switch
              id="enforce-window"
              checked={draft}
              onCheckedChange={(v) => setDraft(!!v)}
              disabled={disabled}
              aria-label={t('windowLabel')}
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
    </section>
  );
}
