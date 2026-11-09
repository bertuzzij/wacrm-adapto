import { ImageResponse } from "next/og";

// Favicon gerado em build time — o Next injeta `<link rel="icon" href="/icon">`.
//
// ATENÇÃO: este arquivo tem PRECEDÊNCIA sobre um eventual `icon.png` no mesmo
// diretório (verificado: o Next emite `/icon` e ignora o PNG). Por isso a arte
// aqui e a de `scripts/generate-pwa-icons.mjs` precisam concordar — são o
// mesmo desenho em dois motores de render distintos. O `glyph-consistency`
// em icons.test.ts falha se as proporções divergirem.
//
// Refino de 2026-11: glifo maior (66% do quadro) e traço mais grosso (2.9 em
// unidades do viewBox 24). Em 16px o traço antigo caía para ~1,6px e o balão
// virava um borrão violeta na aba do navegador.

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  // Mesmas razões do gerador de PNGs: 66% do lado e traço 2.9.
  const side = size.width;
  const glyphBox = side * 0.66;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#7c3aed", // primary (violeta da marca)
          borderRadius: side * 0.22,
        }}
      >
        <svg
          width={glyphBox}
          height={glyphBox}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth={2.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
    ),
    { ...size },
  );
}

