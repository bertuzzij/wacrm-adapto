'use client';

// ============================================================
// Configurações → Notificações.
//
// Reúne o que o atendente ajusta sobre SER AVISADO:
//
//   - notificação do navegador (já existia, mas estava escondida dentro de
//     "Seu perfil", onde ninguém procura um alerta)
//   - som de mensagem nova
//
// Os dois são preferência de DISPOSITIVO (localStorage), não de conta: quem
// atende no notebook com fone e no desktop sem fone quer decisões
// diferentes. A assinatura em conversa individual é o oposto — muda o que o
// cliente recebe — e por isso mora em `accounts`, no bloco abaixo.
// ============================================================

import { useSyncExternalStore } from 'react';
import { Bell, Volume2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import { BrowserNotificationsCard } from '@/components/settings/browser-notifications-card';
import {
  playNotificationSound,
  readSoundPref,
  subscribeSoundPref,
  writeSoundPref,
} from '@/adapto/notifications/sound';
import { SignIndividualCard } from './sign-individual-card';

const serverSnapshot = () => true;

export function NotificationsPanel() {
  const t = useTranslations('Settings.notifications');

  // `useSyncExternalStore` mantém duas abas em sincronia: desligar o som
  // numa aba desliga na outra, sem precisar recarregar.
  const soundOn = useSyncExternalStore(
    subscribeSoundPref,
    readSoundPref,
    serverSnapshot
  );

  function handleSoundToggle(next: boolean) {
    writeSoundPref(next);
    // Toca ao ligar: o usuário confirma que o áudio funciona no
    // dispositivo dele, em vez de descobrir na próxima mensagem.
    if (next) playNotificationSound();
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {/* Notificação do navegador: componente já existente, reaproveitado
          para não duplicar a lógica de permissão. */}
      <BrowserNotificationsCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Volume2 className="size-4 text-primary" />
            {t('soundTitle')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('soundDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <Label htmlFor="notify-sound" className="flex-1 text-muted-foreground">
              {soundOn ? t('soundOn') : t('soundOff')}
            </Label>
            <Switch
              id="notify-sound"
              checked={soundOn}
              onCheckedChange={handleSoundToggle}
              aria-label={t('soundTitle')}
            />
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Bell className="size-3" />
            {t('soundHint')}
          </p>
        </CardContent>
      </Card>

      {/* Assinatura em conversa individual — decisão da CONTA, porque muda
          o texto que o cliente recebe. */}
      <SignIndividualCard />
    </section>
  );
}
