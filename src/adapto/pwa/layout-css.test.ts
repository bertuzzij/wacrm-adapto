import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda-corpo das classes utilitárias de PWA.
 *
 * Contexto do bug que isto previne: `min-h-app` foi usada em 10 arquivos e
 * NUNCA existiu no CSS — o Tailwind só emite o que encontra, e a classe
 * estava apenas no `@layer utilities`… de outro nome. O resultado passou
 * pelo `typecheck` e pelos testes de componente sem um arranhão, e as telas
 * de login ficariam sem altura nenhuma. Nenhum teste de unidade pegaria
 * isso porque o defeito está na folha de estilo compilada, não em código.
 *
 * A verificação aqui é estática (o CSS de entrada), pelo mesmo motivo: um
 * teste que dependesse do build compilado não rodaria no `vitest run`.
 */

const CSS = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

/** Todas as classes utilitárias que o app usa em JSX. */
const APP_SOURCES = [
  "src/app/(dashboard)/dashboard-shell.tsx",
  "src/app/(auth)/login/page.tsx",
  "src/app/(auth)/signup/page.tsx",
  "src/app/(auth)/forgot-password/page.tsx",
  "src/app/(auth)/reset-password/page.tsx",
  "src/app/join/layout.tsx",
];

function definesClass(name: string): boolean {
  return new RegExp(`\\.${name}\\s*\\{`).test(CSS);
}

function usedClassesIn(file: string): string[] {
  const source = readFileSync(join(process.cwd(), file), "utf8");
  return [...source.matchAll(/\b(h-app|min-h-app|p[tblrxy]-safe)\b/g)].map(
    (m) => m[1],
  );
}

describe("PWA layout utilities", () => {
  it("define a altura dinâmica do app", () => {
    expect(definesClass("h-app")).toBe(true);
    expect(definesClass("min-h-app")).toBe(true);
  });

  it("mantém um fallback para navegador sem suporte a dvh", () => {
    // Safari < 15.4 e Chrome < 108 não conhecem `dvh`. Sem o fallback em
    // `100vh`, essas versões ficam sem altura nenhuma.
    const hAppBlock = CSS.slice(
      CSS.indexOf(".h-app"),
      CSS.indexOf(".min-h-app"),
    );
    expect(hAppBlock).toMatch(/100vh/);
    expect(CSS).toMatch(/@supports \(height:\s*100dvh\)/);
  });

  it("define as classes de área segura", () => {
    for (const cls of ["pt-safe", "pb-safe", "pl-safe", "pr-safe", "px-safe"]) {
      expect(definesClass(cls), `.${cls} ausente em globals.css`).toBe(true);
    }
  });

  it("usa env() com fallback de 0px (para não zerar padding no desktop)", () => {
    const matches = [...CSS.matchAll(/env\(safe-area-inset-[a-z]+,\s*0px\)/g)];
    // pt/pb/pl/pr/px-safe = 6 usos, no mínimo.
    expect(matches.length).toBeGreaterThanOrEqual(6);
  });

  it("toda classe de layout usada em JSX existe no CSS", () => {
    // Este é o teste que teria pego o `min-h-app` fantasma.
    const missing: string[] = [];
    for (const file of APP_SOURCES) {
      for (const cls of new Set(usedClassesIn(file))) {
        if (!definesClass(cls)) missing.push(`${cls} (usada em ${file})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
