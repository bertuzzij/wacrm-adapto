"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/adapto/pwa/use-install-prompt";

/**
 * Botão "Instalar app" no cabeçalho.
 *
 * ## Por que existe, se já há um card em Configurações
 *
 * Porque ninguém entra em Configurações para descobrir que dá para
 * instalar. O card explica o passo a passo; este botão é o que faz o
 * usuário SABER que o app existe.
 *
 * ## Quando aparece
 *
 * Só quando há o que fazer:
 *
 *   - `native`          → botão que dispara o prompt do Chrome;
 *   - `ios-manual`      → leva ao card com as instruções (o Safari nunca
 *                         tem prompt, então prometer um botão seria mentira);
 *   - `android-manual`  → idem, instruções do menu;
 *   - `installed`       → some (não faz sentido dentro do app instalado);
 *   - `desktop-manual`  → some. No desktop o ícone já fica na barra de
 *                         endereço e o botão só ocuparia espaço.
 */
export function InstallAppButton() {
  const t = useTranslations("Install");
  const { mode, promptInstall, canPrompt } = useInstallPrompt();
  const [busy, setBusy] = useState(false);

  if (mode === "installed" || mode === "desktop-manual") return null;

  const isNative = mode === "native";

  const onClick = async () => {
    if (!isNative) {
      // Sem prompt: o caminho é o passo a passo do card. Manda para lá em
      // vez de mostrar um toast que some antes de ser lido.
      window.location.assign("/settings?tab=notifications");
      return;
    }

    setBusy(true);
    try {
      await promptInstall();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void onClick()}
      disabled={busy || (isNative && !canPrompt)}
      title={t("desc")}
      // Rótulo visível só a partir de `sm`: no celular o ícone sozinho
      // cabe, e o `aria-label` mantém o nome acessível.
      className="gap-1.5"
      aria-label={t("nav")}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Download className="size-4" />
      )}
      <span className="hidden sm:inline">{t("nav")}</span>
    </Button>
  );
}
