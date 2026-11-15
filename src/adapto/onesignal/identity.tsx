'use client'

import { useEffect } from 'react'

import { useAuth } from '@/hooks/use-auth'
import { loginOneSignal, logoutOneSignal } from './client'
import { onesignalAppId } from './config'

/**
 * Amarra o OneSignal ao usuário logado — headless, não renderiza nada.
 *
 * ## Por que isto precisa existir e por que roda em todo carregamento
 *
 * O envio do servidor mira o usuário por `external_id` (`include_aliases`).
 * Um aparelho que nunca chamou `login()` fica ANÔNIMO no OneSignal: ele pode
 * até ter permissão e uma inscrição, mas nenhum envio por alias o alcança —
 * o sintoma é "ativei, o switch ficou verde e não chega nada".
 *
 * A documentação é explícita: chame `login(external_id)` **a cada
 * carregamento de página** depois de identificar o usuário, e de novo quando
 * o usuário mudar (troca de conta no mesmo aparelho).
 *
 * ## Por que aqui e não no `layout.tsx`
 *
 * Montado no shell do dashboard (abaixo do gate de autenticação), o mesmo
 * lugar do `ServiceWorkerRegistrar`: antes de haver sessão não existe
 * `external_id` para amarrar. E fica fora de arquivo do upstream.
 *
 * ## O `logout` no caminho de saída importa
 *
 * Sem desvincular, um aparelho compartilhado continuaria recebendo avisos da
 * conta anterior — vazamento de conteúdo de mensagem para quem entrou
 * depois. É o mesmo raciocínio que já está na criação da conversa.
 */
export function OneSignalIdentity() {
  const { user, loading } = useAuth()
  const userId = user?.id ?? null

  useEffect(() => {
    if (loading) return
    if (!onesignalAppId()) return

    if (userId) {
      void loginOneSignal(userId)
    } else {
      void logoutOneSignal()
    }
  }, [userId, loading])

  return null
}
