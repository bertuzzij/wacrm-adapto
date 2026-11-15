'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BellRing, CircleAlert, Loader2, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  isIosBrowserTab,
  isPermissionDenied,
  isSecureContext,
  readSubscriptionState,
  subscribeToPush,
  unsubscribeFromPush,
  watchSubscription,
} from '@/adapto/onesignal/client'
import { onesignalAppId } from '@/adapto/onesignal/config'
import {
  resolvePushStatus,
  type PushUiStatus,
  type SubscriptionState,
} from '@/adapto/onesignal/subscription'
import { useInstallPrompt } from '@/adapto/pwa/use-install-prompt'
import { useAuth } from '@/hooks/use-auth'

/**
 * "Notificações no celular" — Web Push via OneSignal.
 *
 * ## Por que separado do card "Notificações do navegador"
 *
 * São coisas diferentes e o usuário precisa entender a diferença:
 *
 *   - **Navegador**: aviso enquanto o app está ABERTO numa aba. O card
 *     existente cuida disso, via realtime do Supabase.
 *   - **Celular (push)**: aviso com o app FECHADO. É este card.
 *
 * Juntar os dois num switch só foi o que produziu o relato "as notificações
 * não funcionam": o usuário ligava o switch de navegador, fechava o app e
 * não recebia nada — porque aquele switch nunca prometeu isso.
 *
 * ## Por que o pedido de permissão sai de um TOQUE
 *
 * No iOS o diálogo nativo só aparece a partir de um gesto do usuário; um
 * pedido disparado em efeito (`useEffect`) ou timer simplesmente não
 * aparece. No Chrome, um pedido fora de contexto é ignorado e, se o usuário
 * negar uma vez, o site não pode mais perguntar. Por isso o `optIn()` é
 * chamado APENAS no `onClick` / `onCheckedChange` abaixo — nunca ao montar.
 */
export function PushNotificationsCard({ className }: { className?: string }) {
  const t = useTranslations('Settings.pushNotifications')
  const { user } = useAuth()
  const { installed } = useInstallPrompt()

  const [state, setState] = useState<SubscriptionState>({
    supported: false,
    permission: false,
    subscribed: false,
    subscriptionId: null,
  })
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Mantém a referência do usuário atual para o listener de mudança não
  // disparar leituras de um usuário que já saiu.
  const userRef = useRef<string | null>(null)
  userRef.current = user?.id ?? null

  const refresh = useCallback(async () => {
    const next = await readSubscriptionState()
    setState(next)
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // O usuário pode mudar a permissão FORA do app (configurações do site) e
  // voltar. Sem observar, o card mostraria o estado antigo até recarregar.
  useEffect(() => {
    let dispose: (() => void) | undefined
    void watchSubscription(() => {
      void refresh()
    }).then((off) => {
      dispose = off
    })
    return () => dispose?.()
  }, [refresh])

  const status: PushUiStatus = resolvePushStatus({
    configured: Boolean(onesignalAppId()),
    secureContext: isSecureContext(),
    supported: state.supported,
    permission: state.permission,
    subscribed: state.subscribed,
    iosBrowserTab: isIosBrowserTab(installed),
    permissionDenied: isPermissionDenied(),
  })

  const onToggle = async (next: boolean) => {
    setBusy(true)
    try {
      if (next) {
        const result = await subscribeToPush()
        if (result.ok) {
          toast.success(t('enabledToast'))
        } else if (result.error === 'permission-denied') {
          toast.error(t('permissionDenied'))
        } else {
          toast.error(t('failedToast'), { description: result.error })
        }
      } else {
        const ok = await unsubscribeFromPush()
        if (ok) {
          toast.success(t('disabledToast'))
        } else {
          toast.error(t('failedToast'))
        }
      }
    } finally {
      setBusy(false)
      // Re-lê do SDK: o estado real é o da inscrição, não o que supomos que
      // aconteceu. Foi confiar na suposição que produziu o switch verde com
      // zero entrega.
      await refresh()
    }
  }

  // No iPhone fora do app instalado não existe push — e oferecer o switch
  // levaria a uma falha sem explicação. O caminho é instalar primeiro.
  if (status === 'ios-needs-install') {
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
    switch (status) {
      case 'not-configured':
        return t('unsupportedConfig')
      case 'insecure':
        return t('unsupportedInsecure')
      case 'blocked':
        return t('permissionDenied')
      default:
        return t('unsupported')
    }
  }

  const isOn = status === 'on'

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
        ) : status === 'not-configured' ||
          status === 'insecure' ||
          status === 'unsupported' ||
          status === 'blocked' ? (
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
                  checked={isOn}
                  onCheckedChange={(next) => void onToggle(next)}
                  disabled={busy}
                  aria-label={t('toggleLabel')}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {isOn ? t('statusOn') : t('statusOff')}
            </p>

            {/* Botão explícito além do switch: o switch cinza lê como
                "desabilitado", não como "clique aqui". Mesmo raciocínio do
                card de navegador. */}
            {!isOn && (
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
