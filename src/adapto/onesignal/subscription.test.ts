import { describe, expect, it } from 'vitest'

import {
  canOfferActivation,
  isSubscriptionUsable,
  needsInstallHint,
  resolvePushStatus,
  type PushUiInput,
} from './subscription'

/**
 * A tabela de decisão do card de push.
 *
 * O card tem SEIS situações diferentes e cada uma precisa de uma ação
 * diferente na tela. Errar a ordem dos testes já produziu beco sem saída:
 * no iPhone aberto como aba, checar "suporte" antes de "iOS" mostrava
 * "navegador sem suporte" — quando o caminho real existia (instalar o app).
 */

function input(overrides: Partial<PushUiInput> = {}): PushUiInput {
  return {
    configured: true,
    secureContext: true,
    supported: true,
    permission: false,
    subscribed: false,
    iosBrowserTab: false,
    permissionDenied: false,
    ...overrides,
  }
}

describe('resolvePushStatus', () => {
  it('sem App ID configurado, não promete nada', () => {
    expect(resolvePushStatus(input({ configured: false }))).toBe('not-configured')
  })

  it('sem HTTPS, o navegador não oferece push', () => {
    expect(resolvePushStatus(input({ secureContext: false }))).toBe('insecure')
  })

  it('no iPhone em aba, a saída é instalar — não "sem suporte"', () => {
    // `supported` costuma ser false aqui porque o iOS nem define
    // `window.Notification` numa aba. Checar iOS primeiro evita um beco sem
    // saída com uma instrução que não leva a lugar nenhum.
    expect(
      resolvePushStatus(input({ iosBrowserTab: true, supported: false })),
    ).toBe('ios-needs-install')
  })

  it('navegador realmente sem suporte', () => {
    expect(resolvePushStatus(input({ supported: false }))).toBe('unsupported')
  })

  it('permissão + inscrição = ligado', () => {
    expect(
      resolvePushStatus(input({ permission: true, subscribed: true })),
    ).toBe('on')
  })

  it('permissão sem inscrição NÃO é ligado', () => {
    // Este é o estado que fazia o switch mentir: o navegador autorizou, a
    // inscrição nunca foi criada, e nada chega.
    expect(
      resolvePushStatus(input({ permission: true, subscribed: false })),
    ).toBe('off')
  })

  it('inscrição sem permissão NÃO é ligado', () => {
    expect(
      resolvePushStatus(input({ permission: false, subscribed: true })),
    ).toBe('off')
  })

  it('permissão negada tem ação própria', () => {
    // Negado → "libere nas configurações do site". Distinto de "não pedido"
    // → "ativar". O botão de ativar não serve de nada quando negado.
    expect(
      resolvePushStatus(input({ permissionDenied: true, permission: false })),
    ).toBe('blocked')
  })

  it('negado vence o estado neutro mesmo se a inscrição existir', () => {
    // Permissão revogada nas configurações do navegador depois de inscrito.
    expect(
      resolvePushStatus(
        input({ permissionDenied: true, permission: false, subscribed: true }),
      ),
    ).toBe('blocked')
  })
})

describe('isSubscriptionUsable', () => {
  it('exige token além de optedIn', () => {
    expect(isSubscriptionUsable({ optedIn: true, token: null })).toBe(false)
    expect(isSubscriptionUsable({ optedIn: true, token: 'abc' })).toBe(true)
  })

  it('optedIn null (SDK ainda carregando) não conta como inscrito', () => {
    expect(isSubscriptionUsable({ optedIn: null, token: 'abc' })).toBe(false)
  })

  it('optOut desliga mesmo com token válido', () => {
    expect(isSubscriptionUsable({ optedIn: false, token: 'abc' })).toBe(false)
  })
})

describe('helpers de UI', () => {
  it('só oferece o botão de ativar quando é possível ativar', () => {
    expect(canOfferActivation('off')).toBe(true)
    for (const status of [
      'on',
      'not-configured',
      'insecure',
      'unsupported',
      'ios-needs-install',
      'blocked',
    ] as const) {
      expect(canOfferActivation(status)).toBe(false)
    }
  })

  it('o aviso de instalar aparece só no caso do iOS', () => {
    expect(needsInstallHint('ios-needs-install')).toBe(true)
    expect(needsInstallHint('off')).toBe(false)
  })
})
