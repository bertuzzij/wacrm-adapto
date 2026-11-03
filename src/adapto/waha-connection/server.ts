/**
 * Acesso ao WAHA a partir do servidor do CRM.
 *
 * Tudo que toca `WAHA_API_KEY` vive aqui. Nenhum componente `'use client'`
 * importa este módulo: as rotas de `/api/adapto/waha-*` são a única porta,
 * e elas nunca devolvem a chave.
 *
 * Reaproveita `waha.ts` do upstream onde já existe (URL base, sessão,
 * headers) em vez de duplicar a leitura de env — se o upstream mudar a
 * forma de configurar o WAHA, esta camada acompanha de graça.
 */
import {
  isWahaMode,
  wahaBaseUrl,
  wahaSession,
  WahaApiError,
} from '@/lib/whatsapp/waha';

/** Teto de tempo para falar com o WAHA. */
const TIMEOUT_MS = 12_000;

function headers(json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const key = process.env.WAHA_API_KEY?.trim();
  if (key) h['X-Api-Key'] = key;
  return h;
}

/**
 * Erro de transporte já traduzido para algo que a rota consegue explicar.
 *
 * `kind` existe para a UI distinguir "o WAHA está fora do ar" (problema de
 * infraestrutura, o usuário não pode resolver) de "o WAHA recusou por causa
 * do estado da sessão" (o usuário pode, escaneando o QR).
 */
export class WahaTransportError extends Error {
  readonly kind: 'not_configured' | 'unreachable' | 'upstream_error';
  readonly httpStatus: number | null;

  constructor(
    message: string,
    kind: WahaTransportError['kind'],
    httpStatus: number | null = null
  ) {
    super(message);
    this.name = 'WahaTransportError';
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  options: { raw?: boolean } = {}
): Promise<T> {
  if (!isWahaMode()) {
    throw new WahaTransportError(
      'WAHA is not configured (WAHA_URL is unset)',
      'not_configured'
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${wahaBaseUrl()}${path}`, {
      method,
      headers: headers(false),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      // Consome o corpo para não vazar o socket, mas não o propaga: a
      // mensagem do WAHA pode conter detalhe interno que não ajuda o
      // usuário e não deve aparecer na tela.
      await response.text().catch(() => '');
      throw new WahaTransportError(
        `WAHA responded ${response.status}`,
        'upstream_error',
        response.status
      );
    }

    if (options.raw) {
      return (await response.arrayBuffer()) as unknown as T;
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  } catch (error) {
    if (error instanceof WahaTransportError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new WahaTransportError('WAHA timed out', 'unreachable');
    }
    throw new WahaTransportError(
      error instanceof Error ? error.message : 'WAHA request failed',
      'unreachable'
    );
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// Leitura
// ------------------------------------------------------------

export interface WahaSessionSnapshot {
  name: string;
  status: string;
  pushName: string | null;
  meId: string | null;
  /**
   * Restrição de alcance que veio junto do `/me`.
   *
   * Nem toda versão do WAHA tem o endpoint dedicado `/timelock` — a
   * 2026.7.2 (CORE) não tem — mas o campo `reachoutTimelock` já vem no
   * `/me`. Como o `/me` é quem carrega o `pushName` de que a tela precisa,
   * ler a restrição daqui sai de graça e funciona nas duas versões.
   */
  reachoutTimelock: {
    isActive: boolean;
    enforcementType: string | null;
    timeEnforcementEnds: number | null;
  } | null;
}

/** `GET /api/sessions/{session}` — o retrato que a tela mostra. */
export async function fetchSession(): Promise<WahaSessionSnapshot> {
  const session = wahaSession();
  const data = await request<{
    name?: string;
    status?: string;
    me?: {
      id?: string;
      pushName?: string;
      reachoutTimelock?: {
        isActive?: boolean;
        enforcementType?: string;
        timeEnforcementEnds?: number;
      } | null;
    } | null;
  }>('GET', `/api/sessions/${encodeURIComponent(session)}`);

  const lock = data.me?.reachoutTimelock;

  return {
    name: data.name ?? session,
    status: data.status ?? 'UNKNOWN',
    pushName: data.me?.pushName?.trim() || null,
    meId: data.me?.id ?? null,
    reachoutTimelock: lock
      ? {
          isActive: Boolean(lock.isActive),
          enforcementType: lock.enforcementType ?? null,
          timeEnforcementEnds:
            typeof lock.timeEnforcementEnds === 'number'
              ? lock.timeEnforcementEnds
              : null,
        }
      : null,
  };
}

/**
 * Restrição de alcance, com fallback por versão.
 *
 * Ordem: o endpoint dedicado `/timelock` (que faz consulta viva ao
 * WhatsApp) e, quando ele não existe nesta versão, o valor já recebido no
 * `/me`. A doc do WAHA recomenda o endpoint dedicado porque o `/me` só é
 * atualizado quando o WhatsApp empurra a mudança; para exibir na tela, a
 * última conhecida serve — e é melhor que não mostrar nada.
 */
export async function fetchTimelock(): Promise<{
  isActive: boolean;
  enforcementType: string | null;
  timeEnforcementEnds: number | null;
  source: 'endpoint' | 'me';
} | null> {
  const session = wahaSession();
  try {
    const data = await request<{
      isActive?: boolean;
      enforcementType?: string;
      timeEnforcementEnds?: number;
    }>('GET', `/api/sessions/${encodeURIComponent(session)}/timelock`);
    return {
      isActive: Boolean(data.isActive),
      enforcementType: data.enforcementType ?? null,
      timeEnforcementEnds:
        typeof data.timeEnforcementEnds === 'number'
          ? data.timeEnforcementEnds
          : null,
      source: 'endpoint',
    };
  } catch {
    // 404 numa versão sem o endpoint, ou falha momentânea: usa o /me.
    try {
      const snapshot = await fetchSession();
      if (snapshot.reachoutTimelock) {
        return { ...snapshot.reachoutTimelock, source: 'me' };
      }
    } catch {
      // sem dado nenhum — a tela simplesmente não mostra a linha
    }
    return null;
  }
}

/**
 * `GET /api/sessions/{session}/capping` — cota de contatos novos.
 *
 * Não existe na 2026.7.2 CORE. Devolve `null` nesse caso: a seção de cota
 * simplesmente não aparece, em vez de a tela mostrar "0 de 0".
 */
export async function fetchCapping(): Promise<{
  cappingStatus: string;
  totalQuota: number;
  usedQuota: number;
  cycleEnd: number | null;
} | null> {
  const session = wahaSession();
  try {
    const data = await request<{
      cappingStatus?: string;
      totalQuota?: number;
      usedQuota?: number;
      cycleEnd?: number;
    }>('GET', `/api/sessions/${encodeURIComponent(session)}/capping`);
    return {
      cappingStatus: data.cappingStatus ?? 'NONE',
      totalQuota: typeof data.totalQuota === 'number' ? data.totalQuota : -1,
      usedQuota: typeof data.usedQuota === 'number' ? data.usedQuota : 0,
      cycleEnd: typeof data.cycleEnd === 'number' ? data.cycleEnd : null,
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// QR code
// ------------------------------------------------------------

/**
 * `GET /api/{session}/auth/qr?format=image` — PNG do QR.
 *
 * Detalhes que o OpenAPI oficial confirma e que são fáceis de errar:
 *   - o `format` é obrigatório e só aceita `image` ou `raw`;
 *   - o endpoint responde 422 se o status não for `SCAN_QR_CODE`, então
 *     ele só é chamado quando a tela sabe que a sessão está nesse estado;
 *   - a resposta é `image/png` binário, não JSON.
 *
 * Devolve `data:` URL pronta para um `<img src>`, o que mantém o QR fora
 * do HTML renderizado no servidor.
 */
export async function fetchQrDataUrl(): Promise<{
  dataUrl: string;
  expiresHintMs: number;
} | null> {
  const session = wahaSession();
  const buffer = await request<ArrayBuffer>(
    'GET',
    `/api/${encodeURIComponent(session)}/auth/qr?format=image`,
    { raw: true }
  );
  const bytes = Buffer.from(buffer);
  if (bytes.length === 0) return null;

  // O WhatsApp gira o QR a cada ~20s; a tela renova antes disso.
  return {
    dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    expiresHintMs: 20_000,
  };
}

// ------------------------------------------------------------
// Reconectar
// ------------------------------------------------------------

/**
 * Põe a sessão em um estado em que o QR possa ser lido.
 *
 * Só faz o que é seguro e reversível:
 *   - `STARTING`/`WORKING` → nada a fazer;
 *   - `STOPPED` → `POST /start` (a sessão precisa estar de pé para gerar QR);
 *   - qualquer outro estado → `POST /restart`, que é o procedimento que a
 *     própria doc do WAHA recomenda para `FAILED`.
 *
 * Deliberadamente NÃO chama `logout`: isso apaga o pareamento e força
 * escanear do zero, o que é destrutivo demais para um botão que o usuário
 * aperta sem entender a diferença.
 */
export async function reconnect(): Promise<{ action: 'start' | 'restart' | 'none' }> {
  const session = wahaSession();
  const current = await fetchSession();
  const status = current.status.toUpperCase();

  if (status === 'WORKING' || status === 'STARTING') {
    return { action: 'none' };
  }

  if (status === 'STOPPED') {
    await request('POST', `/api/sessions/${encodeURIComponent(session)}/start`, {
      raw: false,
    });
    return { action: 'start' };
  }

  await request('POST', `/api/sessions/${encodeURIComponent(session)}/restart`, {
    raw: false,
  });
  return { action: 'restart' };
}

/**
 * Espera a sessão sair de um estado transitório, para a tela não exibir
 * "iniciando" para sempre. Devolve o último status visto, mesmo no timeout:
 * quem chama decide se mostra "ainda iniciando" ou segue.
 */
export async function waitForStatus(
  wanted: (status: string) => boolean,
  timeoutMs = 30_000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = 'UNKNOWN';
  while (Date.now() < deadline) {
    try {
      const snapshot = await fetchSession();
      last = snapshot.status.toUpperCase();
      if (wanted(last)) return last;
    } catch {
      // WAHA pode piscar durante o restart; segue tentando até o prazo.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return last;
}

/** Reexporta para as rotas não precisarem importar de dois lugares. */
export { WahaApiError };
