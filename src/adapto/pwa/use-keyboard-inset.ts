"use client";

import { useEffect, useState } from "react";

/**
 * Quanto o teclado virtual está cobrindo a parte de baixo da tela.
 *
 * ## Por que isto não é resolvido só com CSS
 *
 * Existem dois "viewports" no celular:
 *
 *   - **layout viewport** — o que `100vh`/`100dvh` medem.
 *   - **visual viewport** — a área que o usuário realmente enxerga. É ela
 *     que encolhe quando o teclado abre.
 *
 * Desde o Chrome 108 (Android), abrir o teclado **não redimensiona mais o
 * layout viewport** — só o visual. O iPhone (Safari) sempre se comportou
 * assim. Consequência prática: um rodapé com `position: fixed; bottom: 0`
 * ou um container com `height: 100dvh` fica **atrás do teclado**, e o
 * usuário digita sem ver o campo nem o botão de enviar.
 *
 * O atributo `interactive-widget=resizes-content` resolve isso no Android
 * (está no `viewport` do layout raiz), mas **o Safari o ignora**. Não há
 * como fazer isso só com CSS no iOS, então este hook lê o `visualViewport`
 * e devolve quantos pixels o teclado ocupa, para o composer se deslocar.
 *
 * Devolve `0` no servidor e em navegador sem `visualViewport` — o estado
 * inicial é sempre 0 para não quebrar a hidratação.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const recompute = () => {
      // Distância entre a base do layout viewport e a base do visual.
      // `offsetTop` cobre o caso em que o navegador rola a página para
      // revelar o campo focado.
      const covered =
        window.innerHeight - (vv.height + vv.offsetTop);

      // Abaixo de ~80px é ruído: barra de endereço recolhendo, arredonda-
      // mento de subpixel, ou um teclado de hardware. Tratar isso como
      // teclado faria o composer "pular" ao rolar a página.
      setInset(covered > 80 ? Math.round(covered) : 0);
    };

    recompute();
    vv.addEventListener("resize", recompute);
    vv.addEventListener("scroll", recompute);
    // Girar o aparelho muda tudo; o evento `resize` do visualViewport nem
    // sempre dispara a tempo no iOS.
    window.addEventListener("orientationchange", recompute);

    return () => {
      vv.removeEventListener("resize", recompute);
      vv.removeEventListener("scroll", recompute);
      window.removeEventListener("orientationchange", recompute);
    };
  }, []);

  return inset;
}
