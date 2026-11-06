import { describe, expect, it } from "vitest";
import {
  decideInstallMode,
  detectPlatform,
  isStandalone,
  needsInstallForNotifications,
} from "./install";

/**
 * User agents reais, recortados para o que a detecção usa.
 */
const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadLegacy:
    "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1",
  // iPadOS 13+ se passa por Mac. Este é o caso que quebra detecção ingênua.
  ipadAsMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  desktopMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
};

describe("detectPlatform", () => {
  it("reconhece iPhone", () => {
    expect(detectPlatform({ userAgent: UA.iphone })).toBe("ios");
  });

  it("reconhece iPad antigo pelo user agent", () => {
    expect(detectPlatform({ userAgent: UA.ipadLegacy })).toBe("ios");
  });

  it("reconhece iPad que se passa por Mac (iPadOS 13+)", () => {
    // Sem a regra MacIntel + toque, isto viraria "desktop" e o tablet
    // receberia instrução de Chrome de desktop.
    expect(
      detectPlatform({
        userAgent: UA.ipadAsMac,
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe("ios");
  });

  it("NÃO confunde Mac de verdade com iPad", () => {
    // Mesmo user agent do caso acima, mas sem toque: é um Mac.
    expect(
      detectPlatform({
        userAgent: UA.desktopMac,
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe("desktop");
  });

  it("reconhece Android", () => {
    expect(detectPlatform({ userAgent: UA.android })).toBe("android");
  });

  it("cai em desktop para Chrome de Windows", () => {
    expect(detectPlatform({ userAgent: UA.desktopChrome })).toBe("desktop");
  });

  it("não quebra com user agent vazio", () => {
    expect(detectPlatform({ userAgent: "" })).toBe("desktop");
  });
});

describe("isStandalone", () => {
  it("detecta pelo display-mode (padrão moderno)", () => {
    expect(isStandalone({ displayModeStandalone: true })).toBe(true);
  });

  it("detecta pelo navigator.standalone do iOS", () => {
    expect(isStandalone({ navigatorStandalone: true })).toBe(true);
  });

  it("detecta minimal-ui no Android", () => {
    expect(isStandalone({ displayModeMinimalUi: true })).toBe(true);
  });

  it("é falso dentro do navegador", () => {
    expect(
      isStandalone({
        displayModeStandalone: false,
        navigatorStandalone: false,
        displayModeMinimalUi: false,
      }),
    ).toBe(false);
  });
});

describe("decideInstallMode", () => {
  it("trata como instalado quando o evento appinstalled já disparou", () => {
    // Caso real observado no navegador: o usuário instala pelo botão, o
    // evento `appinstalled` dispara, mas a aba CONTINUA no navegador —
    // `display-mode: standalone` só fica verdadeiro quando o app instalado
    // é aberto. Sem tratar o evento como sinal, o convite reaparece logo
    // depois de o usuário já ter instalado.
    expect(
      decideInstallMode({
        platform: "android",
        promptAvailable: false,
        // A aba segue no navegador:
        displayModeStandalone: false,
        navigatorStandalone: false,
        // …mas o `appinstalled` foi recebido e repassado como standalone.
        appInstalled: true,
      }),
    ).toBe("installed");
  });

  it("appinstalled vence um prompt ainda pendente", () => {
    expect(
      decideInstallMode({
        platform: "android",
        promptAvailable: true,
        appInstalled: true,
      }),
    ).toBe("installed");
  });

  it("não oferece instalar dentro do app já instalado", () => {
    // Este é o erro mais visível possível: um botão "Instalar app" dentro
    // do app instalado. Já instalado vence até o prompt nativo.
    expect(
      decideInstallMode({
        platform: "android",
        promptAvailable: true,
        displayModeStandalone: true,
      }),
    ).toBe("installed");
  });

  it("usa o prompt nativo quando o navegador oferece", () => {
    expect(
      decideInstallMode({ platform: "android", promptAvailable: true }),
    ).toBe("native");
  });

  it("no iOS ensina o caminho, porque nunca há prompt", () => {
    // O Safari não dispara beforeinstallprompt — nem instalado, nem não.
    expect(
      decideInstallMode({ platform: "ios", promptAvailable: false }),
    ).toBe("ios-manual");
  });

  it("no iOS ignora prompt native mesmo se algum dia existir", () => {
    expect(
      decideInstallMode({ platform: "ios", promptAvailable: true }),
    ).toBe("native");
  });

  it("no Android sem prompt cai nas instruções do menu", () => {
    expect(
      decideInstallMode({ platform: "android", promptAvailable: false }),
    ).toBe("android-manual");
  });

  it("no desktop aponta o ícone da barra de endereço", () => {
    expect(
      decideInstallMode({ platform: "desktop", promptAvailable: false }),
    ).toBe("desktop-manual");
  });
});

describe("needsInstallForNotifications", () => {
  it("no iOS dentro do Safari, notificação exige instalar antes", () => {
    // Regra do WebKit (iOS 16.4+): Web Push só existe para app na Tela de
    // Início. Dizer "navegador sem suporte" aqui soa como defeito nosso.
    expect(needsInstallForNotifications("ios", false)).toBe(true);
  });

  it("no iOS já instalado, não é bloqueio de instalação", () => {
    expect(needsInstallForNotifications("ios", true)).toBe(false);
  });

  it("no Android funciona sem instalar", () => {
    expect(needsInstallForNotifications("android", false)).toBe(false);
  });

  it("no desktop funciona sem instalar", () => {
    expect(needsInstallForNotifications("desktop", false)).toBe(false);
  });
});
