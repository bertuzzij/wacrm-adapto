#!/usr/bin/env node
/**
 * Gera os PNGs de ícone do PWA em `public/icons/`.
 *
 * Os binários ficam versionados (manifest.webmanifest e o `<link rel="icon">`
 * do Next apontam para eles), mas ninguém redesenha 5 tamanhos à mão quando
 * a marca muda. Este script é a fonte de verdade reproduzível: rodar
 * `node scripts/generate-pwa-icons.mjs` reescreve tudo igual.
 *
 * A marca é a mesma de `src/app/icon.tsx` e do logo da sidebar: quadrado
 * arredondado violeta (`--primary` = #7c3aed) com o glifo `message-square`
 * do lucide em branco. O path e o stroke-width são copiados literalmente
 * daquele arquivo — se ele mudar, este script também precisa mudar, senão o
 * favicon de 32px e os ícones instalados divergem.
 *
 * Por que SVG rasterizado com sharp em vez de PNG desenhado à mão: o repo já
 * depende de sharp (otimização de imagem no upload de mídia) e o librsvg que
 * vem embutido no binário renderiza exatamente o mesmo path vetorial que o
 * front usa. Assim não entra dependência nova, não entra artefato binário de
 * design, e os 5 tamanhos saem do mesmo desenho por construção.
 *
 * Uso: node scripts/generate-pwa-icons.mjs
 * Idempotente: sobrescreve os arquivos e no fim valida tudo como se fosse a
 * primeira vez, então rodar de novo nunca "passa" com um arquivo corrompido.
 */
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// `import.meta.url` e não `process.cwd()`: assim o script funciona chamado de
// qualquer diretório (inclusive de um hook ou do Docker).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'icons')

const BRAND = {
  background: '#7c3aed', // = --primary do app
  glyph: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  stroke: '#ffffff',
  strokeWidth: 2.5,
}

// ---------------------------------------------------------------------------
// Refino da arte (2026-11): legibilidade em 16px
//
// O glifo original era o `message-square` do lucide em stroke 2.5, dentro de
// 62,5% do quadro. Em 16px (favicon, aba do navegador, barra de status) o
// traço cai para ~1,6px e as hastes verticais do balão somem no serrilhado —
// o ícone vira um borrão violeta.
//
// Ajustes, todos pensados para o tamanho PEQUENO:
//
//   - stroke mais grosso: a linha sobrevive à redução;
//   - glifo maior: aproveita o quadro em vez de boiar no meio;
//   - `rx` do quadro mais generoso: canto arredondado é o que faz o ícone
//     ser lido como "app" e não como retângulo colorido.
//
// Cada valor foi conferido visualmente no PNG final em 16, 32, 180 e 512.
// ---------------------------------------------------------------------------

/** Traço do glifo, em unidades do viewBox 24. Era 2.5. */
const GLYPH_STROKE = 2.9

/** Canto do quadro "any", como fração do lado. Era 6/32 ≈ 18,75%. */
const CORNER_RADIUS_RATIO = 0.22

/** Glifo dentro do quadro "any". Era 20/32 = 62,5%. */
const GLYPH_RATIO = 0.66

// Maskable: o sistema recorta o ícone com o formato que quiser (círculo,
// squircle, gota...) e só garante o círculo interno de diâmetro 80% — ou seja,
// raio 0,4 do lado. Deixamos o glifo em 44% do lado: a tinta (stroke 2,5)
// ocupa ~37,6% da largura e o canto mais distante do centro fica a ~27% do
// lado, com folga confortável dentro do raio seguro de 40%. Verificado abaixo.
const MASKABLE_GLYPH_RATIO = 0.44
const SAFE_ZONE_RATIO = 0.4

/**
 * Desenha a marca num quadrado `size`×`size`.
 *
 * O `<g>` recebe translate+scale em vez de recalcularmos a caixa da tinta: o
 * path do lucide é desenhado no viewBox 24×24 com centro em (12,12), então
 * escalar o grupo inteiro mantém o glifo opticamente centrado sem conta de
 * meia-espessura de stroke na mão (e sem errar 1px em cada tamanho).
 */
function iconSvg(size, { glyphRatio, rounded }) {
  const glyphBox = size * glyphRatio
  const offset = (size - glyphBox) / 2
  const scale = glyphBox / 24

  const corners = rounded
    ? ` rx="${round(size * CORNER_RADIUS_RATIO)}" ry="${round(size * CORNER_RADIUS_RATIO)}"`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}"${corners} fill="${BRAND.background}"/>
  <g transform="translate(${round(offset)} ${round(offset)}) scale(${round(scale, 6)})"
     fill="none" stroke="${BRAND.stroke}" stroke-width="${BRAND.strokeWidth}"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="${BRAND.glyph}"/>
  </g>
</svg>
`
}

/**
 * Ícone monocromático de badge — a silhueta branca que o Android desenha na
 * barra de status.
 *
 * Não pode ser o ícone colorido: `badge` no Android é interpretado como
 * MÁSCARA, então a cor e o fundo viram um quadrado branco chapado. Só a
 * forma sobrevive.
 */
function badgeSvg(size) {
  const glyphBox = size * 0.78
  const offset = (size - glyphBox) / 2
  const scale = glyphBox / 24

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${round(offset)} ${round(offset)}) scale(${round(scale, 6)})"
     fill="none" stroke="#ffffff" stroke-width="${GLYPH_STROKE}"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="${BRAND.glyph}"/>
  </g>
</svg>
`
}

/** Arredonda para 3 casas — evita SVG gigante com 1e-16 de lixo. */
function round(value, digits = 3) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

// ---------------------------------------------------------------------------
// Alvos
//
// `opaque: true` = o PNG sai em RGB (sem canal alfa). Dois motivos diferentes:
//
//  - maskable: o sistema compõe o ícone sobre o launcher dele; qualquer
//    transparência aparece como borda estranha, e canto arredondado é
//    justamente o que o recorte do sistema deveria fazer. Sangra até a borda.
//  - apple-touch-icon: o iOS aplica a própria máscara. Transparência é
//    renderizada como PRETO na tela inicial — é o bug clássico de PWA no iOS,
//    então esse arquivo precisa ser 100% opaco por contrato.
//
// Os "any" (192/512) ficam com canto arredondado e alfa só nos cantos, como o
// favicon. Se algum dia a loja/manifest exigir "any" totalmente opaco, é
// trocar `rounded: true` para `rounded: false` aqui e mais nada.
// ---------------------------------------------------------------------------
const TARGETS = [
  { file: 'icon-192.png', size: 192, glyphRatio: GLYPH_RATIO, rounded: true, opaque: false },
  { file: 'icon-512.png', size: 512, glyphRatio: GLYPH_RATIO, rounded: true, opaque: false },
  {
    file: 'icon-maskable-192.png',
    size: 192,
    glyphRatio: MASKABLE_GLYPH_RATIO,
    rounded: false,
    opaque: true,
    maskable: true,
  },
  {
    file: 'icon-maskable-512.png',
    size: 512,
    glyphRatio: MASKABLE_GLYPH_RATIO,
    rounded: false,
    opaque: true,
    maskable: true,
  },
  { file: 'apple-touch-icon.png', size: 180, glyphRatio: GLYPH_RATIO, rounded: false, opaque: true },
  { file: 'SRC:/apple-icon.png', size: 180, glyphRatio: GLYPH_RATIO, rounded: false, opaque: true },
  // Badge monocromático da barra de status (referenciado no public/sw.js).
  { file: 'badge-96.png', size: 96, badge: true },
]

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------

/**
 * Caminho de saída de um alvo.
 *
 * `SRC:` marca os que moram em `src/app/` (favicon e apple-icon, que o Next
 * injeta sozinho no `<head>`). Sem o prefixo, `path.join(outDir, ...)`
 * normalizaria o `../` e escreveria dentro de `public/`.
 *
 * Fonte única: geração e verificação usam esta função, senão a verificação
 * procura o arquivo no lugar errado e o script "passa" sem validar nada.
 */
function targetPath(target) {
  return target.file.startsWith('SRC:')
    ? path.join(root, 'src', 'app', target.file.slice(4).replace(/^\//, ''))
    : path.join(outDir, target.file)
}

async function render(target) {
  const file = targetPath(target)
  const svg = target.badge ? badgeSvg(target.size) : iconSvg(target.size, target)
  let pipeline = sharp(Buffer.from(svg))

  if (target.opaque) {
    // flatten pinta qualquer pixel semitransparente com o violeta da marca e
    // removeAlpha garante 3 canais mesmo se o librsvg emitir alfa = 255 em
    // tudo. Sem os dois, `metadata().hasAlpha` pode continuar true e o iOS
    // ainda enxerga um PNG RGBA.
    pipeline = pipeline.flatten({ background: BRAND.background }).removeAlpha()
  }

  await pipeline.png({ compressionLevel: 9 }).toFile(file)
  return file
}

// ---------------------------------------------------------------------------
// Verificação
//
// Roda depois de escrever, lendo o arquivo do disco: valida o artefato, não a
// intenção. É o que impede um PNG de 512 salvo como 180 passar batido.
// ---------------------------------------------------------------------------

const failures = []
function check(ok, message) {
  if (!ok) failures.push(message)
}

/** Distância radial máxima, em px, que a tinta branca alcança do centro. */
function inkExtent(data, channels, size) {
  let minX = size
  let minY = size
  let maxX = -1
  let maxY = -1
  let count = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * channels
      // "branco" = os 3 canais acima de 240. O fundo é violeta (124,58,237),
      // então nada do fundo entra nesse filtro, e o antialias de borda do
      // stroke fica de fora — o que deixa a medida do bbox conservadora.
      if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) {
        count++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { count, minX, minY, maxX, maxY }
}

function pixelAt(data, channels, size, x, y) {
  const i = (y * size + x) * channels
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: channels === 4 ? data[i + 3] : 255 }
}

async function verify(target) {
  const file = targetPath(target)
  const meta = await sharp(file).metadata()
  const label = target.file

  check(meta.format === 'png', `${label}: formato ${meta.format}, esperado png`)
  check(meta.width === target.size, `${label}: largura ${meta.width}, esperado ${target.size}`)
  check(meta.height === target.size, `${label}: altura ${meta.height}, esperado ${target.size}`)

  // O contrato do iOS e dos ícones maskable é RGB puro.
  if (target.opaque) {
    check(meta.hasAlpha === false, `${label}: tem canal alfa, precisava ser RGB opaco`)
    check(meta.channels === 3, `${label}: ${meta.channels} canais, esperado 3 (RGB)`)
  }

  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
  const channels = info.channels
  const size = target.size
  const bg = { r: 0x7c, g: 0x3a, b: 0xed }

  // Cantos: opaco → violeta sólido até a borda; arredondado → transparente.
  const corners = [
    [0, 0],
    [size - 1, 0],
    [0, size - 1],
    [size - 1, size - 1],
  ]
  for (const [x, y] of corners) {
    const p = pixelAt(data, channels, size, x, y)
    if (target.opaque) {
      const solid = p.r === bg.r && p.g === bg.g && p.b === bg.b && p.a === 255
      check(solid, `${label}: canto (${x},${y}) não é violeta sólido (${p.r},${p.g},${p.b},a=${p.a})`)
    } else {
      check(p.a === 0, `${label}: canto (${x},${y}) deveria ser transparente, a=${p.a}`)
    }
  }

  const ink = inkExtent(data, channels, size)
  check(ink.count > 0, `${label}: nenhum pixel branco — glifo não foi desenhado`)

  if (ink.count > 0) {
    // Sem clip: tinta não pode encostar na borda.
    const margin = Math.max(1, Math.round(size * 0.02))
    check(
      ink.minX >= margin && ink.minY >= margin && ink.maxX <= size - 1 - margin && ink.maxY <= size - 1 - margin,
      `${label}: glifo encosta na borda (bbox ${ink.minX},${ink.minY}–${ink.maxX},${ink.maxY}, margem ${margin}px)`,
    )

    // Centralização: centro da tinta ≈ centro da imagem (±1px em 512 é ruído
    // de antialias; acima disso é conta errada de offset).
    const cx = (ink.minX + ink.maxX) / 2 + 0.5
    const cy = (ink.minY + ink.maxY) / 2 + 0.5
    const tolerance = 1.5
    check(
      Math.abs(cx - size / 2) <= tolerance && Math.abs(cy - size / 2) <= tolerance,
      `${label}: glifo fora de centro (centro da tinta ${cx},${cy} vs ${size / 2},${size / 2})`,
    )

    // Safe zone dos maskable: nenhum pixel da tinta pode passar do círculo de
    // raio 0,4·lado, senão um launcher que recorta em círculo corta a marca.
    if (target.maskable) {
      const safeRadius = SAFE_ZONE_RATIO * size
      let worst = 0
      for (let y = ink.minY; y <= ink.maxY; y++) {
        for (let x = ink.minX; x <= ink.maxX; x++) {
          const i = (y * size + x) * channels
          if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) {
            const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2)
            if (d > worst) worst = d
          }
        }
      }
      check(
        worst <= safeRadius,
        `${label}: tinta a ${worst.toFixed(1)}px do centro, safe zone é ${safeRadius}px`,
      )
      target._inkRadius = worst
    }
  }

  return meta
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

async function main() {
  await mkdir(outDir, { recursive: true })

  const rows = []
  for (const target of TARGETS) {
    const file = await render(target)
    const meta = await verify(target)
    const { size: bytes } = await stat(file)
    rows.push({ target, meta, bytes })
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} verificação(ões) falharam:\n`)
    for (const f of failures) console.error(`  ✖ ${f}`)
    console.error('\nNenhum diagnóstico acima é cosmético — o arquivo ficou errado no disco.\n')
    process.exit(1)
  }

  console.log(`[icons] ${rows.length} PNGs gerados em ${path.relative(root, outDir)}${path.sep}\n`)
  const header = ['arquivo', 'px', 'canais', 'alfa', 'KB', 'raio da tinta']
  const table = rows.map(({ target, meta, bytes }) => [
    target.file,
    `${meta.width}x${meta.height}`,
    String(meta.channels),
    meta.hasAlpha ? 'sim' : 'não',
    (bytes / 1024).toFixed(1),
    target._inkRadius === undefined ? '—' : `${target._inkRadius.toFixed(1)}/${(SAFE_ZONE_RATIO * target.size).toFixed(0)}`,
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...table.map((r) => r[i].length)))
  const line = (cells) => '  ' + cells.map((c, i) => c.padEnd(widths[i])).join('  ')
  console.log(line(header))
  console.log('  ' + widths.map((w) => '-'.repeat(w)).join('  '))
  for (const row of table) console.log(line(row))
  console.log('')
}

await main()
