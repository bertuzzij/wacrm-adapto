"use client";

import { useState } from "react";
import { Check, Download, Loader2, Share, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useInstallPrompt } from "@/adapto/pwa/use-install-prompt";
import type { InstallMode } from "@/adapto/pwa/install";

/**
 * Passo a passo numerado.
 *
 * Por que uma lista e não um parágrafo: o usuário está com o polegar na
 * tela, muitas vezes dentro de outro app (o link veio pelo WhatsApp), e
 * vai seguir isso de memória. Parágrafo corrido se perde; três linhas
 * numeradas se seguem.
 */
function Steps({ items }: { items: readonly string[] }) {
  return (
    <ol className="space-y-2">
      {items.map((text, index) => (
        <li key={text} className="flex gap-2.5 text-sm text-muted-foreground">
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary"
          >
            {index + 1}
          </span>
          <span className="min-w-0">{text}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Card de instalação do PWA.
 *
 * Existe porque o navegador NÃO faz isso sozinho de forma confiável:
 *
 *   - No Android, o Chrome só mostra a opção dentro do menu (⋮) e ainda
 *     assim depois de cumprir heurísticas de engajamento. Quem não sabe
 *     que ela existe nunca instala — e o pedido foi literalmente "não tem
 *     opção de instalar".
 *   - No iOS não existe prompt nenhum, nunca. Sem instrução, é impossível
 *     descobrir que o caminho é Compartilhar → Adicionar à Tela de Início.
 *   - E no iOS a notificação SÓ funciona com o app instalado, então este
 *     card é pré-requisito do outro.
 *
 * Quando o navegador oferece o prompt nativo, o card vira um botão só.
 * Quando não oferece, ele ensina o caminho do aparelho.
 */
export function InstallAppCard({ className }: { className?: string }) {
  const t = useTranslations("Install");
  const { mode, promptInstall, canPrompt } = useInstallPrompt();
  const [busy, setBusy] = useState(false);

  // Instalado: informa e sai do caminho. Não é `null` porque o usuário que
  // chega aqui procurando "instalar" merece a confirmação de que já está
  // instalado, em vez de uma tela vazia que parece defeito.
  if (mode === "installed") {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Check className="size-4 text-status-good" />
            {t("installedTitle")}
          </CardTitle>
          <CardDescription>{t("installedDesc")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const onInstall = async () => {
    setBusy(true);
    try {
      const outcome = await promptInstall();
      if (outcome === "unavailable") {
        // O evento expira se o app deixar de atender aos critérios por um
        // tempo. Nesse caso o caminho manual ainda vale.
        toast.error(t("androidManualHint"));
      }
    } finally {
      setBusy(false);
    }
  };

  const body = (mode: InstallMode) => {
    switch (mode) {
      case "native":
        return (
          <>
            <p className="text-sm text-muted-foreground">
              {t("androidNativeHint")}
            </p>
            <Button
              type="button"
              onClick={() => void onInstall()}
              disabled={busy || !canPrompt}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 sm:w-auto"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {busy ? t("installing") : t("installButton")}
            </Button>
          </>
        );

      case "ios-manual":
        return (
          <>
            <p className="text-sm text-muted-foreground">{t("iosWhy")}</p>
            <Steps
              items={[t("iosStep1"), t("iosStep2"), t("iosStep3")]}
            />
            <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <Share className="mt-0.5 size-3.5 shrink-0" />
              <span>{t("iosMustBeSafari")}</span>
            </p>
          </>
        );

      case "android-manual":
        return (
          <>
            <p className="text-sm text-muted-foreground">
              {t("androidManualHint")}
            </p>
            <Steps
              items={[t("androidStep1"), t("androidStep2"), t("androidStep3")]}
            />
            <p className="text-xs text-muted-foreground">{t("androidFallback")}</p>
          </>
        );

      default:
        return <p className="text-sm text-muted-foreground">{t("desktopHint")}</p>;
    }
  };

  const title =
    mode === "ios-manual"
      ? t("iosTitle")
      : mode === "android-manual"
        ? t("androidManualTitle")
        : mode === "desktop-manual"
          ? t("desktopTitle")
          : t("androidNative");

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Smartphone className="size-4 text-primary" />
          {title}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t("desc")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{body(mode)}</CardContent>
    </Card>
  );
}
