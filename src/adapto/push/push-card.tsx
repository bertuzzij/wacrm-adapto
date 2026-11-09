'use client'

import { useCallback, useEffect, useState } from 'react'
import { BellRing, CircleAlert, Loader2, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  checkPushSupport,
  getExistingSubscription,
  isRegisteredOnServer,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSupport,
} from '@/adapto/push/client'
import { useInstallPrompt } from '@/adapto/pwa/use-install-prompt'
import { needsInstallForNotifications } from '@/adapto/pwa/install'

/**
 * "Notificações no celular" — Web Push de verdade.
 *
 * ## Por que separado do card "Notificações do navegador"
 *
 * São coisas diferentes e o usuário precisa entender a diferença:
 *
 *   - **Navegador**: aviso enquanto o app está ABERTO numa aba. O card
 *     existente cuida disso, via realtime do Supabase.
 *   - **Celular (push)**: aviso com o app FECHADO. É este card, via Web
 *     Push + service worker.
 *
 * Juntar os dois num switch só foi o que produziu o relato "as notificações
 * não funcionam": o usuário ligava o switch de navegador, fechava o app e
 * não recebia nada — porque aquele switch nunca prometeu isso.
 */
export function PushNotificationsCard({ className }: { className?: string }) {
  const t = useTranslations('Settings.pushNotifications')
  const { platform, installed } = useInstallPrompt()

  const [support, setSupport] = useState<PushSupport>({ supported: false, reason: 'no-service-worker' })
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const supportState = checkPushSupport()
    setSupport(supportState)
    if (supportState.supported) {
      // Não basta existir inscrição no navegador: o servidor precisa
      // conhecê-la. Confiar só no navegador fazia o switch mostrar "Ativo
      // neste aparelho" com o servidor vazio — ligado e mudo ao mesmo tempo.
      const existing = await getExistingSubscription()
      setSubscribed(
        existing ? await isRegisteredOnServer(existing.endpoint) : false,
      )
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const iosNeedsInstall = needsInstallForNotifications(platform, installed)

  const onToggle = async (next: boolean) => {
    setBusy(true)
    try {
      if (next) {
        const result = await subscribeToPush()
        if (result.ok) {
          setSubscribed(true)
          toast.success(t('enabledToast'))
        } else if (result.error === 'permission-denied') {
          toast.error(t('permissionDenied'))
        } else {
          toast.error(t('failedToast'), { description: result.error })
        }
      } else {
        const ok = await unsubscribeFromPush()
        if (ok) {
          setSubscribed(false)
          toast.success(t('disabledToast'))
        } else {
          toast.error(t('failedToast'))
        }
      }
    } finally {
      setBusy(false)
      // Re-lê do navegador: o estado real é o da inscrição, não o que
      // supomos que aconteceu.
      void refresh()
    }
  }

  // No iPhone fora do app instalado não existe push — e oferecer o switch
  // levaria a uma falha sem explicação. O caminho é instalar primeiro.
  if (iosNeedsInstall) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Smartphone className="size-4 text-primary" />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>{t('iosNeedsInstall')}</span>
          </p>
        </CardContent>
      </Card>
    )
  }

  const unsupportedMessage = () => {
    switch (support.reason) {
      case 'no-vapid-key':
        return t('unsupportedConfig')
      case 'insecure':
        return t('unsupportedInsecure')
      default:
        return t('unsupported')
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <BellRing className="size-4 text-primary" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!loaded ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('checking')}
          </p>
        ) : !support.supported ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{unsupportedMessage()}</span>
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div className="min-w-0">
                <Label htmlFor="push-toggle" className="text-sm font-medium text-foreground">
                  {t('toggleLabel')}
                </Label>
                <p className="text-xs text-muted-foreground">{t('toggleDesc')}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                <Switch
                  id="push-toggle"
                  checked={subscribed}
                  onCheckedChange={(next) => void onToggle(next)}
                  disabled={busy}
                  aria-label={t('toggleLabel')}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {subscribed ? t('statusOn') : t('statusOff')}
            </p>

            {/* Botão explícito além do switch: o switch cinza lê como
                "desabilitado", não como "clique aqui". Mesmo raciocínio do
                card de navegador. */}
            {!subscribed && (
              <Button
                type="button"
                size="sm"
                onClick={() => void onToggle(true)}
                disabled={busy}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" />}
                {t('enableNow')}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
