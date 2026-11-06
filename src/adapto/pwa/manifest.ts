import type { Manifest } from "next/dist/lib/metadata/types/manifest-types";
import { APP_NAME } from "@/adapto/brand";
import { getT } from "@/lib/i18n/translate";
import {
  PWA_BACKGROUND_COLOR,
  PWA_ICON_192,
  PWA_THEME_COLOR,
} from "./constants";

/**
 * Dados do Web App Manifest.
 *
 * Por que não escrever isso dentro de `src/app/manifest.ts`: aquele arquivo
 * é território do upstream (existe no repositório original) e o briefing do
 * fork manda deixar o diff lá o menor possível. Aqui é `src/adapto/`, que
 * nunca conflita numa sincronização.
 *
 * O que cada campo resolve na prática:
 *
 *   `id`       — fixa a identidade do app. Sem ele o navegador usa
 *                `start_url`, e mudar `start_url` depois (ex.: de "/" para
 *                "/inbox") passaria a valer como um SEGUNDO app instalado,
 *                com ícone duplicado e link perdido.
 *   `start_url`— vai direto ao dashboard. Abrir em "/" só custaria um
 *                redirect 307 no launch a frio, que aparece como tela branca
 *                por alguns milissegundos.
 *   `scope`    — mantém toda navegação interna dentro da janela do app;
 *                sem isso, um link para fora do escopo abre o navegador.
 *   `display`  — "standalone": sem barra de endereço. É o que faz parecer
 *                aplicativo em vez de site.
 *   `theme_color` / `background_color` — a splash gerada pelo Android e a
 *                cor da barra de status. Ambos batem com o tema escuro
 *                padrão (`--background`) para a transição splash → app não
 *                piscar.
 */

/**
 * `short_name` é o rótulo embaixo do ícone. Android e iOS cortam por volta
 * de 12 caracteres; "AdaptoConect" tem exatamente 12 e passa inteiro.
 */
const SHORT_NAME = APP_NAME;

/**
 * Monta o manifest. `shortcuts` alimentam o menu de toque longo no ícone
 * (Android): os dois destinos que o usuário do CRM abre o dia inteiro.
 */
export function buildManifest(): Manifest {
  const t = getT("Pwa");

  return {
    id: "/",
    name: APP_NAME,
    short_name: SHORT_NAME,
    description: t("description"),
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    // `display_override` foi deliberadamente OMITIDO.
    //
    // Motivo: o Safari/iOS não suporta o campo (usa só `display`), e no
    // Android `standalone` já é o valor de `display` — uma cadeia
    // `["standalone", "minimal-ui"]` não mudaria nada em nenhum dos dois e
    // só adicionaria JSON. "window-controls-overlay" é desktop-only e
    // exigiria construir uma barra de título própria. Se um dia o desktop
    // virar prioridade, aí sim: ["window-controls-overlay", "standalone"].
    background_color: PWA_BACKGROUND_COLOR,
    theme_color: PWA_THEME_COLOR,
    lang: "pt-BR",
    dir: "ltr",
    categories: ["business", "productivity"],
    // `orientation` omitido de propósito: o Safari não suporta o campo, e
    // travar em retrato no Android atrapalha tablet e digitação deitada —
    // exatamente o caso errado para um app de mensagens.
    //
    // Não temos app nativo na loja; apontar para um é o que faria o Chrome
    // esconder o botão "Instalar".
    prefer_related_applications: false,
    icons: [
      {
        src: PWA_ICON_192,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Maskable é um par SEPARADO de propósito. Declarar
      // `purpose: "any maskable"` no mesmo arquivo é o erro clássico: o
      // Android recorta o ícone num círculo e, se a arte tiver margem
      // pequena, o glifo aparece cortado. Aqui o maskable tem zona segura
      // própria.
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: t("shortcutInbox"),
        url: "/inbox",
        icons: [{ src: PWA_ICON_192, sizes: "192x192", type: "image/png" }],
      },
      {
        name: t("shortcutDashboard"),
        url: "/dashboard",
        icons: [{ src: PWA_ICON_192, sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
