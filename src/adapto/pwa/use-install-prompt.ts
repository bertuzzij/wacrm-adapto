"use client";

import { useCallback, useEffect, useState } from "react";
import {
  decideInstallMode,
  detectPlatform,
  isStandalone,
  type InstallMode,
  type InstallPlatform,
} from "./install";

/**
 * O evento `beforeinstallprompt` NÃO existe no lib.dom do TypeScript —
 * é uma extensão do Chromium. Declarado aqui só com o que usamos.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * O evento que o Chromium dispara quando o app JÁ foi instalado (seja por
 * este botão, seja pelo menu do navegador).
 */
const INSTALL_STATE_EVENT = "appinstalled";

/**
 * Captura antecipada do evento.
 *
 * ## Por que existe um módulo global, e não só um `useEffect`
 *
 * O Chrome dispara `beforeinstallprompt` **uma única vez**, pouco depois de
 * o app atender aos critérios de instalabilidade — normalmente antes de o
 * React hidratar e montar este componente. Um listener registrado dentro do
 * `useEffect` chega tarde e nunca recebe o evento; o botão ficaria
 * permanentemente desabilitado e o usuário não veria a opção de instalar.
 *
 * A solução é registrar o listener o mais cedo possível e guardar o evento
 * num slot global. O módulo é importado pelo componente, mas o listener é
 * instalado no primeiro import — e o `useEffect` apenas colhe o que já
 * chegou (ou espera pelo que ainda vai chegar).
 *
 * Não faz nada no servidor nem em navegador sem o evento (iOS, Firefox).
 */
const SLOT = "__adapto_install_prompt__";

type Slot = { event: BeforeInstallPromptEvent | null; installed: boolean };

function getSlot(): Slot | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as Record<string, Slot | undefined>;
  return w[SLOT];
}

function ensureCapture(): void {
  if (typeof window === "undefined") return;
  if (getSlot()) return;

  const slot: Slot = { event: null, installed: false };
  (window as unknown as Record<string, Slot>)[SLOT] = slot;

  window.addEventListener("beforeinstallprompt", (event) => {
    // Sem `preventDefault` o Chrome mostra o próprio mini-infobar e o
    // evento não pode ser reutilizado por nós. Precisamos guardá-lo para
    // disparar no toque do nosso botão.
    event.preventDefault();
    slot.event = event as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event("adapto:install-available"));
  });

  window.addEventListener(INSTALL_STATE_EVENT, () => {
    slot.installed = true;
    // O evento capturado morre depois de instalado; guardá-lo faria o
    // botão tentar um prompt inválido.
    slot.event = null;
    window.dispatchEvent(new Event("adapto:install-available"));
  });
}

ensureCapture();

export interface InstallPromptState {
  /** Já está rodando como app instalado. */
  installed: boolean;
  platform: InstallPlatform;
  mode: InstallMode;
  /** Verdadeiro quando há prompt nativo pronto para disparar. */
  canPrompt: boolean;
  /** Dispara o prompt nativo. No-op quando não há evento. */
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

function readFlags() {
  if (typeof window === "undefined") {
    return {
      platform: "desktop" as InstallPlatform,
      standalone: false,
      promptAvailable: false,
    };
  }

  const nav = window.navigator;
  const slot = getSlot();

  // Duas fontes para "já instalado", e as duas são necessárias:
  //
  //   - `display-mode: standalone` — verdadeiro só quando a página atual
  //     está rodando DENTRO do app instalado.
  //   - `slot.installed` (`appinstalled`) — verdadeiro na aba do navegador
  //     logo após o usuário instalar. Sem esta segunda fonte, a aba
  //     continuaria oferecendo "instalar" (o display-mode só muda quando
  //     o app instalado é aberto), e o usuário veria o convite de novo
  //     depois de já ter aceitado.
  const standalone =
    slot?.installed === true ||
    isStandalone({
      displayModeStandalone: window.matchMedia("(display-mode: standalone)")
        .matches,
      displayModeMinimalUi: window.matchMedia("(display-mode: minimal-ui)")
        .matches,
      // Só existe no iOS; `undefined` em qualquer outro navegador.
      navigatorStandalone: (nav as unknown as { standalone?: boolean })
        .standalone,
    });

  return {
    platform: detectPlatform({
      userAgent: nav.userAgent,
      platform: nav.platform,
      maxTouchPoints: nav.maxTouchPoints,
    }),
    standalone,
    promptAvailable: !!slot?.event,
  };
}
/**
 * Estado de instalação do PWA neste aparelho.
 *
 * Sempre começa "neutro" (nada de install) porque o servidor não conhece o
 * aparelho — decidir no primeiro render causaria divergência de hidratação.
 */
export function useInstallPrompt(): InstallPromptState {
  const [flags, setFlags] = useState(readFlags);

  useEffect(() => {
    const refresh = () => setFlags(readFlags());

    // Re-lê quando o prompt chega/é consumido e quando o app é instalado.
    window.addEventListener("adapto:install-available", refresh);
    window.addEventListener(INSTALL_STATE_EVENT, refresh);
    // O usuário pode instalar pelo menu do navegador e voltar; ao focar a
    // aba o display-mode já mudou.
    window.addEventListener("focus", refresh);

    // Caso o evento tenha chegado entre o render e o efeito.
    refresh();

    return () => {
      window.removeEventListener("adapto:install-available", refresh);
      window.removeEventListener(INSTALL_STATE_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const slot = getSlot();
    const event = slot?.event;
    if (!event) return "unavailable" as const;

    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      // O evento só pode ser usado uma vez, qualquer que seja a escolha.
      slot!.event = null;
      setFlags(readFlags());
      return outcome;
    } catch {
      // Prompt expirado (ex.: o Chrome invalidou depois de muito tempo).
      slot!.event = null;
      setFlags(readFlags());
      return "unavailable" as const;
    }
  }, []);

  return {
    installed: flags.standalone,
    platform: flags.platform,
    mode: decideInstallMode({
      platform: flags.platform,
      promptAvailable: flags.promptAvailable,
      displayModeStandalone: flags.standalone,
    }),
    canPrompt: flags.promptAvailable,
    promptInstall,
  };
}
