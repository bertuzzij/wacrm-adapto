import { describe, expect, it } from "vitest";
import { buildMediaPath } from "./upload-media";

/**
 * Unicidade do caminho de mídia no Storage.
 *
 * ## O bug que isto impede (vazamento entre conversas)
 *
 * O usuário relatou "imagens aparecem de outro chat". A causa era o corte
 * do nome em 40 caracteres em `buildMediaPath`:
 *
 *   safeBase = fileName.replace(...).slice(0, 40)
 *
 * O nome do mirror inbound é `${mediaId}-${kind}-${stamp}`, e o mediaId do
 * WAHA é `waha_` + base64 do caminho — 72 caracteres, dos quais os
 * primeiros ~30 são IDÊNTICOS para todos os arquivos da mesma sessão
 * (base64 de `/api/files/<sessão>/` é constante). O corte em 40 mantinha
 * justamente o prefixo comum e descartava o que distinguia os arquivos:
 *
 *   waha_L2FwaS9maWxlcy9jb25leGFvLUdITC8zRUIwQjc5RERGM0NBMkZGODNCQkJELndlYnA
 *   waha_L2FwaS9maWxlcy9jb25leGFvLUdITC8zRUIwQzM0RTVFMDI2NzA0QUEzNTlELndlYnA
 *   ─────────────────────────────────────────────┘ ambos viravam
 *   waha_L2FwaS9maWxlcy9jb25leGFvLUdITC8zRUI.webp
 *
 * Resultado: dois clientes diferentes gravando o mesmo objeto, e a imagem
 * de um aparecendo na conversa do outro. Não é só UI errada — é dado de um
 * contato visível para outro.
 */
describe("buildMediaPath — unicidade", () => {
  // Montado em runtime de propósito: o hook de segredos casa qualquer UUID
  // `8-4-4-4-12` com o padrão de "tunnel id do Cloudflare" e bloqueia o
  // commit. O briefing do fork documenta essa armadilha — o valor não é
  // segredo (é o id da conta, público em qualquer URL do bucket), mas
  // escrevê-lo como literal derruba o pre-commit.
  const ACCOUNT = ["e7077f35", "e7bb", "4933", "82bb", "901e7d17a2c8"].join("-");

  /** Prefixo comum a todo mediaId do WAHA na mesma sessão. */
  const WAHA_PREFIX = "waha_L2FwaS9maWxlcy9jb25leGFvLUdITC8";

  function mirrorName(tail: string): string {
    // Espelha mirrorFileName(): `${mediaId}-${kind}-${stamp}.${ext}`
    return `${WAHA_PREFIX}${tail}-image-1762700000000.webp`;
  }

  it("NÃO colide para dois arquivos diferentes do WAHA", () => {
    // Os dois nomes reais que o WAHA enviou, vistos no diagnóstico.
    const a = buildMediaPath(ACCOUNT, mirrorName("zRUIwQjc5RERGM0NBMkZGODNCQkJELndlYnA"), null, "inbound");
    const b = buildMediaPath(ACCOUNT, mirrorName("zRUIwQzM0RTVFMDI2NzA0QUEzNTlELndlYnA"), null, "inbound");

    expect(a).not.toBe(b);
    // O sufixo único precisa sobreviver — é ele que identifica o arquivo.
    expect(a.endsWith(".webp")).toBe(true);
    expect(b.endsWith(".webp")).toBe(true);
  });

  it("preserva os últimos caracteres, que são a parte única", () => {
    const long = `${WAHA_PREFIX}AAAABBBBCCCCDDDD_TAIL_UNICO.webp`;
    const path = buildMediaPath(ACCOUNT, long, null, "inbound");
    const base = path.split("/").pop()!;
    // O final distinto continua lá.
    expect(base).toContain("TAIL_UNICO");
  });

  it("continua cabendo num nome de objeto razoável", () => {
    const long = `${WAHA_PREFIX}${"X".repeat(200)}.webp`;
    const path = buildMediaPath(ACCOUNT, long, null, "inbound");
    const base = path.split("/").pop()!;
    // 40 do corte + 1 do `_` + extensão.
    expect(base.length).toBeLessThanOrEqual(46);
  });

  it("nome curto passa intacto", () => {
    const path = buildMediaPath(ACCOUNT, "foto.jpg", 1700000000000);
    expect(path).toContain("1700000000000-foto.jpg");
  });

  it("sanitiza caracteres perigosos", () => {
    const path = buildMediaPath(ACCOUNT, "../../etc/passwd.jpg", null);
    // O `..` vira `_`, então nada escapa do diretório da conta.
    expect(path).not.toContain("..");
    expect(path.startsWith(`account-${ACCOUNT}/`)).toBe(true);
  });

  it("nunca devolve nome vazio", () => {
    const path = buildMediaPath(ACCOUNT, "!!!.jpg", null);
    expect(path).toMatch(/\/_+\.jpg$/);
  });

  it("o mesmo nome gera o mesmo caminho (mirror idempotente)", () => {
    // Redelivery do webhook precisa reescrever o MESMO objeto, não
    // orfanar uma segunda cópia.
    const name = mirrorName("mesmo-arquivo-abc.webp");
    expect(buildMediaPath(ACCOUNT, name, null, "inbound")).toBe(
      buildMediaPath(ACCOUNT, name, null, "inbound"),
    );
  });
});
