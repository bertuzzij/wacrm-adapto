import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "@/components/themed-toaster";
import { APP_NAME, APP_TITLE_TEMPLATE } from "@/adapto/brand";
import {
  PWA_APPLE_TOUCH_ICON,
  PWA_THEME_COLOR,
} from "@/adapto/pwa/constants";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  MODES,
  STORAGE_KEY,
  THEME_IDS,
} from "@/lib/themes";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return {
    ...metadata,
    description: t("description"),
  };
}

const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: APP_TITLE_TEMPLATE,
  },
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: [{ url: "/icon" }],
    // Ícone do iOS. Precisa ser arquivo PNG opaco: o iOS ignora o SVG do
    // `/icon` e, se a imagem tiver transparência, pinta os cantos de preto.
    // O Next injeta `<link rel="apple-touch-icon">` a partir daqui.
    apple: [{ url: PWA_APPLE_TOUCH_ICON, sizes: "180x180", type: "image/png" }],
  },
  // Metas do PWA no iOS. O Safari NÃO lê `display`/`name` do manifest para
  // decidir se abre em tela cheia — quem decide é `appleWebApp.capable`.
  // Sem isso, o ícone adicionado à tela de início abre com a barra de
  // endereço do Safari e o app deixa de parecer nativo.
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    // "black-translucent" deixa o conteúdo passar por baixo da barra de
    // status (efeito edge-to-edge) — por isso o shell trata safe-area.
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: PWA_THEME_COLOR,
  colorScheme: "dark light",
  // `cover` estica o layout até as bordas físicas da tela; sem ele os
  // `env(safe-area-inset-*)` que o shell usa valem zero e o conteúdo fica
  // dentro de uma moldura com faixas. É o pré-requisito do recorte do
  // iPhone e do Android com gesture bar.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  // Teclado do Android/iOS: com "resizes-content" o viewport encolhe e o
  // composer do inbox sobe junto com o teclado. Com o padrão
  // ("resizes-visual") o teclado cobre o campo e o usuário digita às cegas.
  interactiveWidget: "resizes-content",
};

// Inline boot script — runs before React hydrates so the user's
// chosen accent (data-theme) AND mode (data-mode) are on the <html>
// element before first paint. Without this every page load flashes
// the server-rendered defaults for a frame before the React tree
// mounts and applies the picked values.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid ids is
// sourced from the THEME_IDS / MODES constants so adding one doesn't
// silently break the boot path.
const THEME_BOOT_SCRIPT = `
(function(){
  var d = document.documentElement;
  try {
    var THEME_KEY = ${JSON.stringify(STORAGE_KEY)};
    var THEME_DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var THEMES = ${JSON.stringify(THEME_IDS)};
    var savedTheme = localStorage.getItem(THEME_KEY);
    d.dataset.theme = THEMES.indexOf(savedTheme) !== -1 ? savedTheme : THEME_DEFAULT;

    var MODE_KEY = ${JSON.stringify(MODE_STORAGE_KEY)};
    var MODE_DEFAULT = ${JSON.stringify(DEFAULT_MODE)};
    var MODES = ${JSON.stringify(MODES)};
    var savedMode = localStorage.getItem(MODE_KEY);
    d.dataset.mode = MODES.indexOf(savedMode) !== -1 ? savedMode : MODE_DEFAULT;
  } catch (_e) {
    d.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
    d.dataset.mode = ${JSON.stringify(DEFAULT_MODE)};
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      data-theme={DEFAULT_THEME}
      data-mode={DEFAULT_MODE}
      className={`${inter.variable} h-full antialiased`}
      // The `theme-boot` script below rewrites `data-theme` and
      // `data-mode` on <html> from localStorage before React hydrates,
      // so for any non-default choice the client DOM intentionally
      // differs from the server-rendered defaults. suppressHydration-
      // Warning silences the expected mismatch — it only applies to
      // this element's own attributes, so genuine mismatches in
      // children still surface.
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider>
            {children}
            <ThemedToaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
