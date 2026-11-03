/**
 * Traduz o estado bruto do WAHA em algo que uma pessoa não técnica entende.
 *
 * Este arquivo é puro de propósito: sem `fetch`, sem `process.env`, sem
 * `next`. Assim dá para testar cada estado possível sem um servidor WAHA
 * no ar — e estados de falha são justamente os difíceis de reproduzir
 * quando você mais precisa deles.
 *
 * O WAHA devolve `session.status` com valores em caixa alta que descrevem
 * o protocolo, não a experiência: `SCAN_QR_CODE` não diz a ninguém que
 * "precisa escanear o QR". `PASSKEY_REQUIRED` não diz que o WhatsApp está
 * pedindo confirmação no celular. A tradução acontece aqui.
 */

/** Estados documentados em https://waha.devlike.pro/docs/how-to/sessions/ */
export const WAHA_STATUSES = [
  'STOPPED',
  'STARTING',
  'SCAN_QR_CODE',
  'PASSKEY_REQUIRED',
  'PASSKEY_CONFIRMATION_REQUIRED',
  'WORKING',
  'FAILED',
] as const;

export type WahaStatus = (typeof WAHA_STATUSES)[number] | 'UNKNOWN';

/**
 * Como a conexão está, na linguagem de quem usa o CRM:
 *
 *   connected  tudo certo, pode mandar mensagem
 *   action     precisa que a pessoa faça algo (escanear QR, confirmar no celular)
 *   busy       o WAHA está subindo; só esperar
 *   down       caiu e não volta sozinho
 *   unknown    não deu para perguntar (WAHA fora do ar, chave errada, rede)
 */
export type ConnectionState =
  | 'connected'
  | 'action'
  | 'busy'
  | 'down'
  | 'unknown';

export interface ConnectionView {
  state: ConnectionState;
  /** O status cru, para quem quiser o detalhe técnico. */
  rawStatus: WahaStatus;
  /** i18n key under `Settings.waha` — the sentence shown to the user. */
  messageKey: string;
  /** i18n key for what to do about it. Empty when nothing is needed. */
  hintKey: string;
  /** Only meaningful when true: the caller may fetch a QR code. */
  canFetchQr: boolean;
  /** Show the "reconnect" button? False while already healthy. */
  canReconnect: boolean;
}

/**
 * `PASSKEY_REQUIRED` / `PASSKEY_CONFIRMATION_REQUIRED` são estados que a
 * maioria dos pareamentos nunca alcança (o WhatsApp confirma sozinho), mas
 * quando acontecem o QR não resolve — a pessoa precisa agir no celular.
 * Tratá-los como `SCAN_QR_CODE` faria a tela mostrar um QR inútil.
 */
export function describeStatus(raw: string | null | undefined): ConnectionView {
  const status = normalizeStatus(raw);

  switch (status) {
    case 'WORKING':
      return {
        state: 'connected',
        rawStatus: status,
        messageKey: 'statusConnected',
        hintKey: '',
        canFetchQr: false,
        canReconnect: false,
      };

    case 'SCAN_QR_CODE':
      return {
        state: 'action',
        rawStatus: status,
        messageKey: 'statusNeedsQr',
        hintKey: 'hintNeedsQr',
        canFetchQr: true,
        canReconnect: true,
      };

    case 'PASSKEY_REQUIRED':
      return {
        state: 'action',
        rawStatus: status,
        messageKey: 'statusNeedsPasskey',
        hintKey: 'hintNeedsPasskey',
        canFetchQr: false,
        canReconnect: true,
      };

    case 'PASSKEY_CONFIRMATION_REQUIRED':
      return {
        state: 'action',
        rawStatus: status,
        messageKey: 'statusNeedsConfirmation',
        hintKey: 'hintNeedsConfirmation',
        canFetchQr: false,
        canReconnect: true,
      };

    case 'STARTING':
      return {
        state: 'busy',
        rawStatus: status,
        messageKey: 'statusStarting',
        hintKey: 'hintStarting',
        canFetchQr: false,
        canReconnect: false,
      };

    case 'STOPPED':
      return {
        state: 'down',
        rawStatus: status,
        messageKey: 'statusStopped',
        hintKey: 'hintStopped',
        canFetchQr: false,
        canReconnect: true,
      };

    case 'FAILED':
      return {
        state: 'down',
        rawStatus: status,
        messageKey: 'statusFailed',
        hintKey: 'hintFailed',
        canFetchQr: true,
        canReconnect: true,
      };

    default:
      return {
        state: 'unknown',
        rawStatus: status,
        messageKey: 'statusUnknown',
        hintKey: 'hintUnknown',
        canFetchQr: false,
        canReconnect: true,
      };
  }
}

export function normalizeStatus(raw: string | null | undefined): WahaStatus {
  const value = (raw ?? '').trim().toUpperCase();
  return (WAHA_STATUSES as readonly string[]).includes(value)
    ? (value as WahaStatus)
    : 'UNKNOWN';
}

// ------------------------------------------------------------
// Conflitos — as restrições que o WhatsApp impõe e que o CRM precisa
// mostrar sem assustar nem esconder.
// ------------------------------------------------------------

export interface ReachoutTimelock {
  enforcementType?: string | null;
  isActive?: boolean | null;
  /** Unix timestamp em SEGUNDOS (não milissegundos), como o WAHA entrega. */
  timeEnforcementEnds?: number | null;
}

export interface MessageCapping {
  cappingStatus?: string | null;
  totalQuota?: number | null;
  usedQuota?: number | null;
  cycleStart?: number | null;
  cycleEnd?: number | null;
}

export type ConflictSeverity = 'info' | 'warning' | 'critical';

export interface Conflict {
  /** i18n key under `Settings.waha`. */
  messageKey: string;
  severity: ConflictSeverity;
  /**
   * Quando o problema se resolve sozinho (epoch ms). `null` quando não há
   * data conhecida, ou quando não é um problema temporário.
   */
  endsAt: number | null;
  /** Números para a frase montada na tela ("640 de 1000"). */
  values?: Record<string, string | number>;
}

/**
 * `timeEnforcementEnds` vem em segundos. Multiplicar por 1000 na hora de
 * exibir é fácil de esquecer e produz uma data em 1970 que parece bug do
 * produto — então a conversão mora aqui, com teste.
 */
export function toEpochMs(seconds: number | null | undefined): number | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  // Um valor já em milissegundos (13 dígitos) não deve ser multiplicado.
  return seconds > 1e11 ? Math.round(seconds) : Math.round(seconds * 1000);
}

/**
 * Lista o que está atrapalhando o envio, em ordem de gravidade.
 *
 * O ponto importante para quem não é técnico: nos dois casos abaixo a
 * conexão está **boa**. Reiniciar ou reparear não resolve — só piora.
 * Por isso `severity` nunca é `critical` aqui: é uma restrição temporária
 * do WhatsApp, não uma falha do sistema.
 */
export function describeConflicts(input: {
  timelock?: ReachoutTimelock | null;
  capping?: MessageCapping | null;
}): Conflict[] {
  const conflicts: Conflict[] = [];

  const lock = input.timelock;
  if (lock?.isActive) {
    const endsAt = toEpochMs(lock.timeEnforcementEnds);
    conflicts.push({
      messageKey: 'conflictTimelock',
      severity: 'warning',
      endsAt,
      values: { type: lock.enforcementType ?? '' },
    });
  }

  const cap = input.capping;
  const capStatus = (cap?.cappingStatus ?? 'NONE').toUpperCase();
  const total = typeof cap?.totalQuota === 'number' ? cap.totalQuota : 0;
  const used = typeof cap?.usedQuota === 'number' ? cap.usedQuota : 0;

  if (capStatus === 'CAPPED') {
    conflicts.push({
      messageKey: 'conflictCapped',
      severity: 'warning',
      endsAt: toEpochMs(cap?.cycleEnd),
      values: { used, total },
    });
  } else if (capStatus === 'SECOND_WARNING') {
    conflicts.push({
      messageKey: 'conflictCappingHigh',
      severity: 'warning',
      endsAt: toEpochMs(cap?.cycleEnd),
      values: { used, total },
    });
  } else if (capStatus === 'FIRST_WARNING') {
    conflicts.push({
      messageKey: 'conflictCappingLow',
      severity: 'info',
      endsAt: toEpochMs(cap?.cycleEnd),
      values: { used, total },
    });
  }

  return conflicts.sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity)
  );

  function severityRank(s: ConflictSeverity): number {
    return s === 'critical' ? 3 : s === 'warning' ? 2 : 1;
  }
}

/** Quanto da cota já foi usado, 0..100. `null` quando não há cota. */
export function cappingUsagePercent(
  capping: MessageCapping | null | undefined
): number | null {
  const total = capping?.totalQuota;
  const used = capping?.usedQuota;
  if (typeof total !== 'number' || typeof used !== 'number') return null;
  // -1 é como o WAHA diz "esta conta não tem limite".
  if (total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((used / total) * 100)));
}

/**
 * `me.id` chega como `5511999999999@c.us`. Mostrar o JID inteiro na tela
 * não ajuda ninguém; o telefone formatado, sim.
 */
export function formatPhoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const digits = jid.split('@')[0].replace(/\D/g, '');
  if (digits.length < 10) return null;

  // Formato brasileiro: 55 + DDD (2) + 8 ou 9 dígitos.
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    const head = rest.length === 9 ? rest.slice(0, 5) : rest.slice(0, 4);
    const tail = rest.slice(head.length);
    return `+55 ${ddd} ${head}-${tail}`;
  }
  return `+${digits}`;
}
