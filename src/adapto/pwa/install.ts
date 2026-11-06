/**
 * Decisão de "como instalar o app neste aparelho".
 *
 * Por que isto é um módulo puro, sem tocar em `window`: a regra tem
 * detalhes que erram com facilidade (iPad se disfarça de Mac, Android sem
 * prompt nativo, iOS que nunca terá prompt) e nenhum deles é verificável
 * de olho. Aqui as entradas são valores explícitos, então o comportamento
 * em cada aparelho fica testável sem aparelho.
 *
 * O estado real do navegador é lido pelo hook em `use-install-prompt.ts`.
 */

export type InstallPlatform = "ios" | "android" | "desktop";

/**
 * Como oferecer a instalação:
 *
 *   `native`      — o navegador tem o prompt de instalação (`beforeinstallprompt`);
 *                   basta um botão.
 *   `ios-manual`  — iOS/Safari NUNCA dispara esse evento. A única via é
 *                   Compartilhar → Adicionar à Tela de Início, então a UI
 *                   precisa ENSINAR, não oferecer botão.
 *   `android-manual` — Android sem prompt capturado (ex.: o evento disparou
 *                   antes do listener montar); o caminho é o menu do Chrome.
 *   `desktop-manual` — desktop; o ícone de instalação aparece na barra de
 *                   endereço.
 *   `installed`   — já está rodando como app instalado.
 *   `none`        — não faz sentido oferecer.
 */
export type InstallMode =
  | "native"
  | "ios-manual"
  | "android-manual"
  | "desktop-manual"
  | "installed"
  | "none";

export interface PlatformInput {
  userAgent: string;
  /** `navigator.platform`. No iPadOS 13+ é "MacIntel". */
  platform?: string;
  /** `navigator.maxTouchPoints`. iPad com touch reporta > 1 mesmo como MacIntel. */
  maxTouchPoints?: number;
}

/**
 * Detecta a plataforma.
 *
 * O caso que exige cuidado é o **iPad**: desde o iPadOS 13 o Safari envia
 * um user agent de Macintosh, então procurar só "iPad" no UA erra e o
 * aparelho cai em `desktop` — mostrando uma instrução de Chrome desktop
 * para quem está num tablet. A assinatura confiável é MacIntel + toque.
 */
export function detectPlatform({
  userAgent,
  platform,
  maxTouchPoints,
}: PlatformInput): InstallPlatform {
  const ua = userAgent || "";

  // iPad se passando por Mac.
  const isIpadAsMac =
    platform === "MacIntel" && (maxTouchPoints ?? 0) > 1;

  if (/iPad|iPhone|iPod/.test(ua) || isIpadAsMac) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export interface StandaloneInput {
  /** `matchMedia('(display-mode: standalone)').matches` — padrão. */
  displayModeStandalone?: boolean;
  /** `navigator.standalone` — só existe no iOS. */
  navigatorStandalone?: boolean;
  /** `matchMedia('(display-mode: minimal-ui)')` etc. */
  displayModeMinimalUi?: boolean;
  /**
   * O evento `appinstalled` já disparou nesta aba.
   *
   * Separado de `displayModeStandalone` porque os dois medem coisas
   * diferentes: `display-mode` é verdadeiro quando a página roda DENTRO do
   * app instalado, enquanto `appinstalled` é verdadeiro na aba do navegador
   * logo depois de instalar. Sem este sinal, a aba que acabou de instalar
   * continuaria mostrando "Instalar app".
   */
  appInstalled?: boolean;
}

/**
 * Já está aberto como app instalado?
 *
 * Três sinais porque nenhum cobre tudo: `display-mode: standalone` é o
 * padrão moderno; `navigator.standalone` é o que o iOS expõe; e no Android
 * um app instalado também pode abrir em `minimal-ui`.
 */
export function isStandalone({
  displayModeStandalone,
  navigatorStandalone,
  displayModeMinimalUi,
  appInstalled,
}: StandaloneInput): boolean {
  return (
    displayModeStandalone === true ||
    navigatorStandalone === true ||
    displayModeMinimalUi === true ||
    appInstalled === true
  );
}

export interface InstallDecisionInput extends StandaloneInput {
  platform: InstallPlatform;
  /** O navegador entregou um `beforeinstallprompt` utilizável? */
  promptAvailable: boolean;
}

/**
 * Decide o modo de instalação a oferecer.
 *
 * Ordem importa:
 *   1. já instalado vence tudo — oferecer "instalar" dentro do app
 *      instalado é o erro mais visível que essa UI pode cometer;
 *   2. prompt nativo vence as instruções manuais, porque é um toque só;
 *   3. iOS vem antes de Android no caso manual: o iOS é o único onde o
 *      usuário NÃO tem como descobrir sozinho o caminho.
 */
export function decideInstallMode({
  platform,
  promptAvailable,
  ...standaloneInput
}: InstallDecisionInput): InstallMode {
  if (isStandalone(standaloneInput)) return "installed";
  if (promptAvailable) return "native";

  if (platform === "ios") return "ios-manual";
  if (platform === "android") return "android-manual";
  return "desktop-manual";
}

/**
 * Notificação no iOS exige o app instalado na Tela de Início — não é
 * escolha nossa, é regra do WebKit desde o iOS 16.4. Devolve `true` quando
 * este é o motivo de a notificação não estar disponível, para a UI
 * explicar em vez de dizer "navegador sem suporte" (que soa como defeito).
 */
export function needsInstallForNotifications(
  platform: InstallPlatform,
  standalone: boolean,
): boolean {
  return platform === "ios" && !standalone;
}
