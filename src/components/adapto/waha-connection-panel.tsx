'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  QrCode,
  RefreshCw,
  ServerCrash,
  WifiOff,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/hooks/use-auth';
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import type { Conflict, ConnectionState } from '@/adapto/waha-connection/status';

/**
 * Acompanhamento da conexão do WhatsApp via WAHA.
 *
 * Desenhado para quem não é técnico: em vez de `SCAN_QR_CODE`, mostra
 * "É preciso escanear o QR code"; em vez de `RESTRICT_ALL_COMPANIONS`,
 * explica que o WhatsApp limitou temporariamente o envio para contatos
 * novos — e, o mais importante, avisa que **não** adianta reiniciar
 * nesse caso.
 *
 * Duas situações que a tela trata explicitamente porque são confundidas
 * com frequência:
 *
 *   - "Conflito" (timelock / capping) NÃO é conexão caída. Reconectar ali
 *     não resolve e a doc do WAHA pede para não fazer. Por isso o aviso
 *     aparece em destaque e o botão de reconectar fica fora do card.
 *   - WAHA fora do ar (rede) é diferente de sessão desconectada. No
 *     primeiro caso nem o QR adianta; a tela diz que é o servidor.
 */

interface StatusPayload {
  configured: boolean;
  unreachable?: boolean;
  error?: string;
  session?: {
    name: string;
    status: string;
    phone: string | null;
    pushName: string | null;
  };
  connection?: {
    state: ConnectionState;
    messageKey: string;
    hintKey: string;
    canFetchQr: boolean;
    canReconnect: boolean;
  };
  metrics?: {
    lastActivityAt: number | null;
    engineConnected: boolean | null;
    received24h: number | null;
    sent24h: number | null;
    failed24h: number | null;
  };
  conflicts?: Conflict[];
  cappingUsage?: number | null;
}

/** Quanto tempo cada tipo de problema pode ficar na tela antes de reconsultar. */
const POLL_CONNECTED_MS = 60_000;
const POLL_ISSUE_MS = 10_000;

export function WahaConnectionPanel() {
  const t = useTranslations('Settings.waha');
  const { canEditSettings } = useAuth();

  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);
  const [confirmPair, setConfirmPair] = useState(false);

  // Guarda o timer para não deixar duas cadeias de polling rodando quando
  // o componente re-renderiza ou o usuário reconecta.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/adapto/waha/status', { cache: 'no-store' });
      const json = (await res.json()) as StatusPayload;
      if (!aliveRef.current) return;
      setData(json);
    } catch {
      if (!aliveRef.current) return;
      setData({ configured: true, unreachable: true, error: 'unreachable' });
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  // Polling adaptativo: quando está tudo bem, uma consulta por minuto
  // basta; quando há problema, o usuário está olhando a tela e esperando,
  // então reconsultamos mais rápido. Um intervalo fixo curto gastaria
  // requisições sem ninguém olhando, e um fixo longo deixaria a tela
  // travada em "desconectado" depois de reconectar.
  useEffect(() => {
    aliveRef.current = true;
    void load();

    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [load]);

  useEffect(() => {
    if (loading) return;
    const healthy = data?.connection?.state === 'connected';
    const delay = healthy && !data?.conflicts?.length ? POLL_CONNECTED_MS : POLL_ISSUE_MS;
    timerRef.current = setTimeout(() => {
      void load().then(() => {
        // `load` atualiza `data`, o que reexecuta este efeito e agenda o
        // próximo ciclo com o intervalo correto para o novo estado.
      });
    }, delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [data, loading, load]);

  // Busca o QR quando a sessão pede pareamento. Renova sozinho: o WhatsApp
  // troca o código a cada ~20s e um QR vencido na tela é pior que nenhum.
  const fetchQr = useCallback(async () => {
    setQrError(false);
    try {
      const res = await fetch('/api/adapto/waha/qr', { cache: 'no-store' });
      if (!res.ok) {
        setQrError(true);
        setQr(null);
        return;
      }
      const json = (await res.json()) as { dataUrl: string };
      if (!aliveRef.current) return;
      setQr(json.dataUrl);
    } catch {
      if (aliveRef.current) setQrError(true);
    }
  }, []);

  useEffect(() => {
    if (!data?.connection?.canFetchQr) {
      setQr(null);
      return;
    }
    void fetchQr();
    const id = setInterval(() => void fetchQr(), 20_000);
    return () => clearInterval(id);
  }, [data?.connection?.canFetchQr, fetchQr]);

  const handleReconnect = async () => {
    setBusy(true);
    setQr(null);
    try {
      const res = await fetch('/api/adapto/waha/reconnect', { method: 'POST' });
      const json = (await res.json()) as { error?: string; status?: string };
      if (!res.ok) {
        toast.error(
          json.error === 'not_configured'
            ? t('errorNotConfigured')
            : t('errorReconnect')
        );
        return;
      }
      toast.success(t('reconnectStarted'));
      await load();
    } catch {
      toast.error(t('errorReconnect'));
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  // Pareamento novo: destrutivo, então passa por confirmação explícita.
  // `forcePairing` no servidor faz logout + start; a diferença para o
  // reconnect comum é justamente descartar o aparelho já pareado.
  const handleForcePair = async () => {
    setConfirmPair(false);
    setBusy(true);
    setQr(null);
    try {
      const res = await fetch('/api/adapto/waha/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'pair' }),
      });
      const json = (await res.json()) as { error?: string; status?: string };
      if (!res.ok) {
        toast.error(
          json.error === 'not_configured'
            ? t('errorNotConfigured')
            : t('errorReconnect')
        );
        return;
      }
      toast.success(t('pairStarted'));
      await load();
    } catch {
      toast.error(t('errorReconnect'));
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t('loading')}
      </div>
    );
  }

  // WAHA não configurado: não é erro do usuário, é instalação incompleta.
  if (data && !data.configured) {
    return (
      <div>
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <Alert>
          <Info className="h-4 w-4" aria-hidden />
          <AlertTitle>{t('notConfiguredTitle')}</AlertTitle>
          <AlertDescription>{t('notConfiguredDesc')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // WAHA fora do ar: a sessão pode estar perfeita; quem caiu foi o servidor.
  if (data?.unreachable) {
    return (
      <div>
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <Alert variant="destructive">
          <WifiOff className="h-4 w-4" aria-hidden />
          <AlertTitle>{t('unreachableTitle')}</AlertTitle>
          <AlertDescription>{t('unreachableDesc')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const state = data?.connection?.state ?? 'unknown';
  const showConflicts = (data?.conflicts?.length ?? 0) > 0;

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          data?.connection?.canReconnect && canEditSettings ? (
            <Button onClick={handleReconnect} disabled={busy} size="sm">
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
              )}
              {busy ? t('reconnecting') : t('reconnect')}
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <StateIcon state={state} />
            {t(`state.${state}` as Parameters<typeof t>[0])}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t((data?.connection?.messageKey ?? 'statusUnknown') as Parameters<typeof t>[0])}
          </p>

          {data?.session?.phone ? (
            <dl className="grid gap-1 text-sm sm:grid-cols-[140px_1fr]">
              <dt className="text-muted-foreground">{t('phoneLabel')}</dt>
              <dd className="font-medium text-foreground">{data.session.phone}</dd>
              {data.session.pushName ? (
                <>
                  <dt className="text-muted-foreground">{t('accountNameLabel')}</dt>
                  <dd className="font-medium text-foreground">{data.session.pushName}</dd>
                </>
              ) : null}
            </dl>
          ) : null}

          {data?.connection?.hintKey ? (
            <p className="text-sm text-muted-foreground">
              {t(data.connection.hintKey as Parameters<typeof t>[0])}
            </p>
          ) : null}

          {data?.connection?.canFetchQr ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
              {qr ? (
                // `data:` URL: o QR nunca é renderizado no servidor nem
                // passa por HTML que possa ficar em cache.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qr}
                  alt={t('qrAlt')}
                  width={240}
                  height={240}
                  className="rounded bg-white p-2"
                />
              ) : qrError ? (
                <p className="text-sm text-muted-foreground">{t('qrUnavailable')}</p>
              ) : (
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
              )}
              <p className="text-center text-xs text-muted-foreground">{t('qrHowTo')}</p>
            </div>
          ) : null}

          {/* Métricas: primeiro as que o WAHA informa, depois as do banco.
              A pergunta que esta seção responde é "está funcionando agora?" —
              status WORKING sozinho não prova que as mensagens passam. */}
          <MetricsBlock metrics={data?.metrics} t={t} />

          {showConflicts ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">
                {t('conflictsTitle')}
              </h3>
              <p className="text-sm text-muted-foreground">{t('conflictsIntro')}</p>
              <ul className="space-y-2">
                {data!.conflicts!.map((conflict, index) => (
                  <li key={`${conflict.messageKey}-${index}`}>
                    <Alert
                      variant={conflict.severity === 'info' ? 'default' : 'destructive'}
                    >
                      <ConflictIcon severity={conflict.severity} />
                      <AlertDescription>
                        {t(conflict.messageKey as Parameters<typeof t>[0], {
                          ...(conflict.values as Record<string, string | number>),
                          endsAt: conflict.endsAt
                            ? new Date(conflict.endsAt).toLocaleString()
                            : t('endsUnknown'),
                        })}
                      </AlertDescription>
                    </Alert>
                  </li>
                ))}
              </ul>
              {data?.cappingUsage !== null && data?.cappingUsage !== undefined ? (
                <div className="space-y-1">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-amber-500"
                      style={{ width: `${data.cappingUsage}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('cappingUsage', { percent: data.cappingUsage })}
                  </p>
                </div>
              ) : null}

              {/* A instrução que evita o pior: reiniciar não resolve
                  restrição do WhatsApp e pode atrapalhar. */}
              <p className="text-sm font-medium text-foreground">{t('conflictsNoRestart')}</p>
            </div>
          ) : null}

          {!canEditSettings ? (
            <p className="text-xs text-muted-foreground">{t('adminOnlyHint')}</p>
          ) : null}

          {/* Pareamento novo fica sempre acessível a admin — inclusive com a
              sessão conectada, que é justamente quando alguém quer trocar de
              número. Fica separado do "Reconectar" porque apaga o aparelho
              já pareado, e um botão desses não pode parecer inofensivo. */}
          {canEditSettings ? (
            <div className="border-t border-border pt-4">
              {confirmPair ? (
                <div className="space-y-2">
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" aria-hidden />
                    <AlertTitle>{t('pairConfirmTitle')}</AlertTitle>
                    <AlertDescription>{t('pairConfirmDesc')}</AlertDescription>
                  </Alert>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={handleForcePair}
                      disabled={busy}
                      size="sm"
                      variant="destructive"
                    >
                      {busy ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                      ) : null}
                      {t('pairConfirmYes')}
                    </Button>
                    <Button
                      onClick={() => setConfirmPair(false)}
                      disabled={busy}
                      size="sm"
                      variant="outline"
                    >
                      {t('pairConfirmNo')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t('pairTitle')}
                    </p>
                    <p className="text-xs text-muted-foreground">{t('pairDesc')}</p>
                  </div>
                  <Button
                    onClick={() => setConfirmPair(true)}
                    disabled={busy}
                    size="sm"
                    variant="outline"
                  >
                    <QrCode className="mr-2 h-4 w-4" aria-hidden />
                    {t('pairAction')}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Métricas de conexão.
 *
 * Duas fontes, de propósito:
 *   - "Último sinal" e "Motor" vêm do WAHA: provam que o servidor está de pé
 *     e falando com o WhatsApp.
 *   - As contagens de 24h vêm do banco do CRM: provam que as mensagens
 *     realmente atravessam o sistema.
 *
 * `null` nunca vira "0". "Não consegui contar" e "nada passou" são coisas
 * diferentes, e mostrar 0 no primeiro caso assustaria sem motivo.
 */
function MetricsBlock({
  metrics,
  t,
}: {
  metrics?: StatusPayload['metrics'];
  t: ReturnType<typeof useTranslations<'Settings.waha'>>;
}) {
  if (!metrics) return null;

  const { lastActivityAt, engineConnected, received24h, sent24h, failed24h } = metrics;

  // Sem nenhum dado útil não renderizamos a seção vazia.
  const hasAnything =
    lastActivityAt !== null ||
    engineConnected !== null ||
    received24h !== null ||
    sent24h !== null ||
    failed24h !== null;
  if (!hasAnything) return null;

  const relative = formatRelative(lastActivityAt);
  const failedIsBad = typeof failed24h === 'number' && failed24h > 0;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
      <h3 className="text-sm font-semibold text-foreground">{t('metricsTitle')}</h3>

      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t('metricEngine')}</dt>
          <dd className="font-medium">
            {engineConnected === null ? (
              <span className="text-muted-foreground">{t('metricUnknown')}</span>
            ) : engineConnected ? (
              <span className="text-emerald-600">{t('metricEngineOk')}</span>
            ) : (
              <span className="text-amber-600">{t('metricEngineDown')}</span>
            )}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t('metricLastActivity')}</dt>
          <dd className="font-medium">
            {relative ?? <span className="text-muted-foreground">{t('metricUnknown')}</span>}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t('metricReceived')}</dt>
          <dd className="font-medium">
            {received24h === null ? (
              <span className="text-muted-foreground">{t('metricUnknown')}</span>
            ) : (
              t('metricMessages', { count: received24h })
            )}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t('metricSent')}</dt>
          <dd className="font-medium">
            {sent24h === null ? (
              <span className="text-muted-foreground">{t('metricUnknown')}</span>
            ) : (
              t('metricMessages', { count: sent24h })
            )}
          </dd>
        </div>

        {failed24h !== null ? (
          <div className="flex items-center justify-between gap-2 sm:col-span-2">
            <dt className="text-muted-foreground">{t('metricFailed')}</dt>
            <dd className={`font-medium ${failedIsBad ? 'text-destructive' : ''}`}>
              {t('metricMessages', { count: failed24h })}
            </dd>
          </div>
        ) : null}
      </dl>

      <p className="text-xs text-muted-foreground">{t('metricsWindow')}</p>
    </div>
  );
}

/**
 * "há 2 minutos" a partir de um epoch ms.
 *
 * `Intl.RelativeTimeFormat` cuida do idioma (o app tem en/pt/es/ko) sem
 * precisar de uma chave de tradução por unidade de tempo.
 */
function formatRelative(epochMs: number | null): string | null {
  if (epochMs === null) return null;
  const diffMs = Date.now() - epochMs;
  if (!Number.isFinite(diffMs)) return null;

  const diffSec = Math.round(diffMs / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (Math.abs(diffSec) < 60) return rtf.format(-diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, 'minute');
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return rtf.format(-diffHour, 'hour');
  return rtf.format(-Math.round(diffHour / 24), 'day');
}

function StateIcon({ state }: { state: ConnectionState }) {
  if (state === 'connected') {
    return <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />;
  }
  if (state === 'unknown') {
    return <ServerCrash className="h-5 w-5 text-muted-foreground" aria-hidden />;
  }
  if (state === 'busy') {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />;
  }
  return <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />;
}

function ConflictIcon({ severity }: { severity: Conflict['severity'] }) {
  if (severity === 'info') {
    return <Info className="h-4 w-4" aria-hidden />;
  }
  return <AlertTriangle className="h-4 w-4" aria-hidden />;
}
