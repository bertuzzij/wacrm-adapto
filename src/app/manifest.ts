import type { MetadataRoute } from "next";
import { buildManifest } from "@/adapto/pwa/manifest";

/**
 * Next.js serve este arquivo em `/manifest.webmanifest` e injeta
 * `<link rel="manifest">` em todas as páginas.
 *
 * A implementação mora em `src/adapto/pwa/manifest.ts` (ver o comentário
 * lá). Este arquivo é só a rota — os dados ficam fora do território do
 * upstream.
 */
export default function manifest(): MetadataRoute.Manifest {
  return buildManifest() as MetadataRoute.Manifest;
}
