"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/adapto/pwa/notify";

/**
 * Registra o service worker uma vez por sessão.
 *
 * Montado no shell do dashboard (abaixo do gate de autenticação) e não no
 * root layout de propósito: as telas de login/signup não precisam de SW, e
 * registrá-lo antes de haver sessão só aumentaria a superfície sem
 * benefício.
 *
 * O registro é o que faz o aviso de mensagem nova funcionar no Android —
 * lá o Chrome exige `ServiceWorkerRegistration.showNotification()` e
 * proíbe `new Notification()`. Ver src/adapto/pwa/notify.ts.
 *
 * Headless: não renderiza nada.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  return null;
}
