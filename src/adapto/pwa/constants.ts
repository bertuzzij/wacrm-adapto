/**
 * Constantes do PWA compartilhadas entre servidor (manifest) e cliente
 * (notificações).
 *
 * Ficam num módulo sem `import` de nada para poderem ser lidas dos dois
 * lados sem puxar React, next-intl ou o catálogo de mensagens.
 */

/** Cor da barra de status e do fundo da splash. Igual a `--background` escuro. */
export const PWA_THEME_COLOR = "#020617";

export const PWA_BACKGROUND_COLOR = "#020617";

/** Ícone quadrado de 192px — também usado como ícone de aviso. */
export const PWA_ICON_192 = "/icons/icon-192.png";

/** Ícone do iOS (opaco, sem cantos arredondados, 180x180). */
export const PWA_APPLE_TOUCH_ICON = "/icons/apple-touch-icon.png";
