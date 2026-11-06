import { describe, expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import nextConfig from "../next.config";

async function headersFor(pathname: string) {
  const rules = (await nextConfig.headers?.()) ?? [];
  const values = rules
    .filter((rule) => getPathMatch(rule.source, { strict: true })(pathname))
    .flatMap((rule) => rule.headers);
  return values;
}

async function cacheControlFor(pathname: string) {
  const headers = await headersFor(pathname);
  return headers.filter((h) => h.key.toLowerCase() === "cache-control").at(-1)
    ?.value;
}

describe("next.config Cache-Control", () => {
  it.each(["/", "/login", "/signup", "/dashboard", "/inbox/123", "/settings/team", "/join/abc"])(
    "keeps %s out of shared caches",
    async (pathname) => {
      const value = await cacheControlFor(pathname);
      expect(value).toBe("private, no-store");
      expect(value).not.toMatch(/public|s-maxage|stale-while-revalidate/);
    },
  );

  it("sends no-store on API routes", async () => {
    expect(await cacheControlFor("/api/whatsapp/templates")).toBe("no-store");
  });

  it.each(["/_next/static/chunks/app.js", "/_next/image"])(
    "leaves %s to Next's own caching",
    async (pathname) => {
      expect(await cacheControlFor(pathname)).toBeUndefined();
    },
  );
});

describe("next.config PWA headers", () => {
  // O navegador só troca o service worker quando consegue revalidar o
  // arquivo. Um `sw.js` cacheado = usuário preso numa versão antiga do
  // worker por meses, sem forma de corrigir.
  it("never caches the service worker", async () => {
    const value = await cacheControlFor("/sw.js");
    expect(value).toMatch(/no-cache/);
    expect(value).toMatch(/no-store/);
    expect(value).not.toMatch(/max-age=[1-9]/);
  });

  it("serves the service worker as JavaScript", async () => {
    const headers = await headersFor("/sw.js");
    const contentType = headers.find(
      (h) => h.key.toLowerCase() === "content-type",
    )?.value;
    // Um SW com MIME errado é recusado com "unsupported MIME type".
    expect(contentType).toMatch(/application\/javascript/);
  });

  it("lets icons be cached, but not forever", async () => {
    const value = await cacheControlFor("/icons/icon-192.png");
    // Cacheável (não é dado por usuário)…
    expect(value).toMatch(/public/);
    expect(value).toMatch(/max-age=\d+/);
    // …mas não `immutable`: o caminho não tem hash, então um ícone novo
    // precisa conseguir substituir o antigo num deploy.
    expect(value).not.toMatch(/immutable/);
  });

  it("applies the no-store rule to the offline page", async () => {
    // offline.html NÃO deve ficar no HTTP cache: o service worker guarda a
    // própria cópia no Cache Storage, e uma segunda cópia no HTTP cache
    // seria uma fonte de divergência invisível.
    expect(await cacheControlFor("/offline.html")).toBe("private, no-store");
  });
});
