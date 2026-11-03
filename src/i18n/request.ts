import { getRequestConfig } from 'next-intl/server';

// Mesmo padrão do next.config.ts: `pt` neste fork, porque é o idioma da
// instalação. Manter os dois em sincronia importa — o config resolve o
// alias `@app-messages` (código fora do React) e este arquivo resolve o
// dicionário do lado React; divergir aqui dá metade da tela num idioma.
const DEFAULT_APP_LOCALE = 'pt';

export default getRequestConfig(async () => {
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE || DEFAULT_APP_LOCALE;

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // Fallback para o padrão se o dicionário do locale pedido não existir.
    messages = (await import(`../../messages/${DEFAULT_APP_LOCALE}.json`)).default;
  }

  return {
    locale,
    messages
  };
});
