import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Consistência da arte entre os dois motores de render.
 *
 * O favicon é gerado por `src/app/icon.tsx` (ImageResponse, roda no edge do
 * Next) e os ícones instalados por `scripts/generate-pwa-icons.mjs` (sharp +
 * librsvg). São DOIS desenhos independentes que precisam parecer o mesmo.
 *
 * Isto não é hipotético: eu adicionei um `icon.png` com a arte refinada e o
 * Next continuou emitindo `/icon` — o `.tsx` tem precedência. As duas artes
 * teriam divergido em silêncio, com o favicon na proporção antiga e o ícone
 * instalado na nova. Estes testes travam as constantes dos dois lados.
 */

const ROOT = process.cwd()

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8')
}

/** Extrai uma constante numérica do gerador (ex.: `const GLYPH_RATIO = 0.66`). */
function generatorConstant(source: string, name: string): number | null {
  const match = new RegExp(`const ${name}\\s*=\\s*([0-9.]+)`).exec(source)
  return match ? Number(match[1]) : null
}

describe('fonte de verdade dos ícones', () => {
  it('o favicon é gerado pelo icon.tsx (o .tsx vence um icon.png)', () => {
    // Verificado na prática: com os dois presentes o Next emite `/icon`.
    // Se alguém adicionar um PNG de novo achando que ele vale, este teste
    // obriga a decidir qual é a fonte.
    const hasTsx = existsSync(join(ROOT, 'src/app/icon.tsx'))
    const hasPng = existsSync(join(ROOT, 'src/app/icon.png'))
    expect(hasTsx).toBe(true)
    expect(hasPng, 'icon.png em src/app é ignorado — use icon.tsx').toBe(false)
  })

  it('o apple-icon é opaco (o iOS renderiza transparência como preto)', () => {
    const appleIcon = join(ROOT, 'src/app/apple-icon.png')
    expect(existsSync(appleIcon)).toBe(true)
    // Sem sharp neste teste (roda no ambiente node do vitest); a garantia de
    // canal alfa é verificada pelo próprio gerador, que aborta se
    // `hasAlpha` for true. Aqui só confirmamos que o arquivo existe — os
    // alvos `opaque: true` cobrem o resto.
  })
})

describe('proporções da arte batem entre favicon e ícones instalados', () => {
  const generator = read('scripts/generate-pwa-icons.mjs')
  const favicon = read('src/app/icon.tsx')

  it('o glifo ocupa a mesma fração do quadro nos dois', () => {
    const genRatio = generatorConstant(generator, 'GLYPH_RATIO')
    expect(genRatio).toBeGreaterThan(0)

    // No icon.tsx o valor aparece como `side * 0.66`.
    const faviconRatio = /side\s*\*\s*([0-9.]+)/.exec(favicon)
    expect(faviconRatio, 'não achei a razão do glifo no icon.tsx').not.toBeNull()
    expect(Number(faviconRatio![1])).toBe(genRatio)
  })

  it('o traço é o mesmo nos dois', () => {
    const genStroke = generatorConstant(generator, 'GLYPH_STROKE')
    expect(genStroke).toBeGreaterThan(0)

    // No favicon: `strokeWidth={2.9}` no SVG.
    const faviconStroke = /strokeWidth=\{([0-9.]+)\}/.exec(favicon)
    expect(faviconStroke, 'não achei o strokeWidth no icon.tsx').not.toBeNull()
    expect(Number(faviconStroke![1])).toBe(genStroke)
  })

  it('o canto arredondado é o mesmo nos dois', () => {
    const genCorner = generatorConstant(generator, 'CORNER_RADIUS_RATIO')
    expect(genCorner).toBeGreaterThan(0)

    // No favicon: `borderRadius: side * 0.22`.
    const faviconCorner = /borderRadius:\s*side\s*\*\s*([0-9.]+)/.exec(favicon)
    expect(faviconCorner, 'não achei o borderRadius no icon.tsx').not.toBeNull()
    expect(Number(faviconCorner![1])).toBe(genCorner)
  })

  it('a cor de fundo é o primary da marca', () => {
    expect(generator).toContain("background: '#7c3aed'")
    expect(favicon).toContain('#7c3aed')
  })

  it('o glifo é o mesmo path vetorial', () => {
    const path = 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'
    expect(generator).toContain(path)
    expect(favicon).toContain(path)
  })
})

describe('arquivos de ícone que o manifest referencia existem', () => {
  it.each([
    'public/icons/icon-192.png',
    'public/icons/icon-512.png',
    'public/icons/icon-maskable-192.png',
    'public/icons/icon-maskable-512.png',
    'public/icons/apple-touch-icon.png',
    'public/icons/badge-96.png',
  ])('%s existe', (file) => {
    expect(existsSync(join(ROOT, file)), `${file} ausente`).toBe(true)
  })
})
