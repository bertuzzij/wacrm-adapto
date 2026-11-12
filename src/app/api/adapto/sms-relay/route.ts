// ============================================================
// POST /api/adapto/sms-relay
//
// RELAY DE SMS → WHATSAPP.
//
// NECESSIDADE: os códigos 2FA da Amplimed chegam por SMS no celular, e o
// atendente às vezes está longe dele. O app de encaminhamento no Android
// (MacroDroid/Tasker) faz POST aqui; esta rota replica a mensagem para o
// WhatsApp do próprio número, onde ela fica visível no WhatsApp Web.
//
// O WAHA não escuta SMS: a escuta mora no app do celular, e este servidor
// é só a ponte — por isso a chave do WAHA nunca precisa sair daqui.
//
// AUTENTICAÇÃO: token dedicado no header, igual ao webhook do WAHA. É um
// segredo distinto de propósito: o app do celular é a superfície mais
// exposta do caminho (celular perdido, app desinstalado por alguém), e um
// token próprio limita o que essa exposição alcança — nada além de
// "mandar texto pro meu próprio WhatsApp".
//
// A FILTRAGEM acontece aqui (ver `@/adapto/sms-relay/rules`): só SMS cujo
// corpo casa com o padrão da Amplimed é replicado. Sem isso, qualquer SMS
// do aparelho transbordaria para o WhatsApp.
// ============================================================

import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getT } from '@/lib/i18n/translate';
import {
  formatSmsRelayMessage,
  selfChatId,
  shouldForwardSms,
} from '@/adapto/sms-relay/rules';
import { sendTextMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';

const t = getT('Api');

/** Header onde o app do celular traz o token. */
const TOKEN_HEADER = 'x-sms-relay-token';

/** Cliente service-role: a rota roda sem sessão de usuário (ver abaixo). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

/** Profundidade máxima da busca recursiva — o payload do app é raso. */
const MAX_EXTRACT_DEPTH = 6;

/**
 * Procura, recursivamente, um valor de texto que case com o padrão de um
 * SMS da Amplimed.
 *
 * Existiu para encerrar a saga de placeholders: cada app de encaminhamento
 * monta o corpo de um jeito (`{"body": …}` aqui, `{from, message, …}` no
 * SMS Forwarder), e o placeholder de variável não era expandido por
 * nenhum deles. Em vez de o servidor impor seu formato, ele procura o
 * texto do SMS onde quer que o app o tenha colocado.
 *
 * Devolve o PRIMEIRO valor que casa — e é seguro: o que casa é, por
 * definição, um SMS da Amplimed, que é o único conteúdo esta rota replica.
 * Chaves como `token`, `secret`, `authorization` são puladas (um app
 * mal-configurado pode colocar a própria credencial no corpo; nunca a
 * devolvemos como se fosse mensagem).
 */
function extractSmsText(value: unknown, depth = 0): string | null {
  if (depth > MAX_EXTRACT_DEPTH) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && shouldForwardSms(trimmed).forward) return trimmed;
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractSmsText(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    const SKIP_KEYS = new Set([
      'token', 'secret', 'authorization', 'password', 'apikey', 'api_key',
    ]);
    // Campos de TEXTO primeiro, chaves de metadado por último — o texto do
    // SMS tem nomes óbvios (`message`, `body`, `text`, `msg`); procurar
    // neles antes reduz a chance de casar num campo decorativo.
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => {
        const texty = (k: string) =>
          ['message', 'body', 'text', 'msg', 'content'].includes(k.toLowerCase())
            ? 0
            : 1;
        return texty(a) - texty(b);
      },
    );
    for (const [key, child] of entries) {
      if (SKIP_KEYS.has(key.toLowerCase())) continue;
      const found = extractSmsText(child, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    // ------------------------------------------------------------
    // Token dedicado. Comparação em tempo constante: a rota é pública
    // (o celular fala com ela pela internet) e um token que dá acesso a
    // enviar mensagens merece a defesa.
    // ------------------------------------------------------------
    const expected = process.env.SMS_RELAY_TOKEN?.trim();
    if (!expected) {
      console.error(
        '[sms-relay] SMS_RELAY_TOKEN not configured — refusing to run open'
      );
      return NextResponse.json(
        { error: t('common.serviceUnavailable') },
        { status: 503 }
      );
    }

    const provided =
      request.headers.get(TOKEN_HEADER)?.trim() ??
      new URL(request.url).searchParams.get('token')?.trim() ??
      '';
    // Mesmo padrão do webhook WAHA (`tokenOk`): hash antes de comparar
    // torna a comparação em tempo constante com o `crypto` do Node, que é
    // o runtime disponível aqui (o `crypto` web não tem timingSafeEqual).
    const a = crypto.createHash('sha256').update(expected).digest()
    const b = crypto.createHash('sha256').update(provided).digest()
    if (!crypto.timingSafeEqual(a, b)) {
      return NextResponse.json({ error: t('common.unauthorized') }, { status: 401 });
    }

    const rawBody = await request.text();

    // ------------------------------------------------------------
    // Aceita o formato que vier, porque os apps reais provaram não haver
    // UM formato:
    //
    //   1. {"body": "<texto>"}          — o formato canônico desta rota
    //   2. o texto do SMS cru           — sem envelope nenhum
    //   3. o JSON nativo do app         — SMS Forwarder manda o pacote
    //                                     completo dele ({from, message,
    //                                     date, sentTime, ...})
    //
    // O caso 3 é o que encerrou a saga de placeholders: MacroDroid não
    // expandia variável no campo, SMS Forwarder mandava o placeholder
    // LITERAL (`[msg]`, 5 bytes) mesmo inserido pelo seletor. Em vez de
    // continuar caçando o token certo de cada app, o servidor extrai o
    // texto de onde ele estiver — procurando recursivamente o primeiro
    // valor string que case com o padrão da Amplimed.
    //
    // O FILTRO continua sendo a única porta: o que não casa com o padrão
    // da Amplimed nunca é replicado, não importa o envelope.
    // ------------------------------------------------------------
    let smsBody = '';
    let parseNote: string;
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      const extracted = extractSmsText(parsed);
      // O campo canônico `body` tem prioridade quando é texto; sem ele, o
      // que a extração achou no resto do payload manda.
      const canonical =
        parsed && typeof parsed === 'object' && typeof (parsed as { body?: unknown }).body === 'string'
          ? ((parsed as { body: string }).body || extracted || '')
          : (extracted ?? '');
      smsBody = canonical;
      parseNote = 'json';
    } catch {
      // Não é JSON: trata o corpo inteiro como o texto do SMS.
      smsBody = rawBody;
      parseNote = 'raw-text';
    }

    const decision = shouldForwardSms(smsBody);

    // Log da decisão, SEM o conteúdo (o corpo do SMS pode conter código e
    // contexto pessoal; só comprimento, motivo e formato bastam para
    // diagnosticar).
    console.log(
      `[sms-relay] received ${smsBody.length} bytes (${parseNote}), decision=${decision.reason}, code=${decision.code ? 'yes' : 'no'}`
    );

    // DIAGNÓSTICO TEMPORÁRIO (remover após estabilizar): quando o corpo não
    // casa com o padrão, registra o começo dele — sem isso, um app que
    // envia o texto errado é invisível e a depuração depende de adivinhação.
    // Controlado por env var para não virar hábito.
    if (
      !decision.forward &&
      process.env.SMS_RELAY_DEBUG_REJECTS === 'true' &&
      smsBody.length > 0
    ) {
      console.warn(
        `[sms-relay] REJECTED body (${smsBody.length} bytes): ${smsBody.slice(0, 80)}`
      );
    }

    if (!decision.forward) {
      // 200 com `forwarded: false`, não 4xx: para o app do celular, "não
      // encaminhou" é um resultado NORMAL e esperado — a maioria dos SMS
      // não é da Amplimed. Um erro faria o app retentar em vão.
      return NextResponse.json({ forwarded: false, reason: decision.reason });
    }

    // ------------------------------------------------------------
    // Destinatário: o próprio número.
    //
    // `whatsapp_config` NÃO tem coluna com o número — e não é o
    // `phone_number_id` da Meta que mora ali: no modo WAHA este campo
    // guarda o PRÓPRIO TELEFONE (verificado: "551699…", 13 dígitos), pois
    // é assim que o bridge grava `chatIdToPhone(meId)` do evento.
    //
    // Leitura com service-role, sem sessão de usuário: o app do celular
    // fala com esta rota de fora do app, então NÃO há cookie Supabase —
    // o token do header É a autenticação. O `waha-webhook` segue o mesmo
    // padrão. Config é único por conta; `.order().limit(1)` em vez de
    // `maybeSingle`, que lança se duplicatas existirem (lição do bug dos
    // contatos de grupo).
    // ------------------------------------------------------------
    const { data: configs, error: configError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .order('created_at', { ascending: true })
      .limit(1)

    // Em WAHA o número é o phone_number_id; sem WAHA, a rota não se aplica
    // (não há "mensagem para mim mesmo" fora do modo de pareamento).
    const selfPhone = (configs?.[0]?.phone_number_id ?? '').replace(/\D/g, '');
    if (configError || !selfPhone) {
      return NextResponse.json(
        { error: t('common.whatsappNotConfigured') },
        { status: 400 }
      );
    }

    // Nota: no modo WAHA o `sendTextMessage` ignora os args Meta e usa
    // `wahaSendText` — o token nunca é usado de fato. Em Meta, o token
    // decifrado do banco seria o correto; como o relay só existe no modo
    // WAHA, passar o valor decifrado mantém os dois caminhos honestos.
    const accessToken = configs?.[0]?.access_token
      ? decrypt(configs[0].access_token)
      : '';

    const message = formatSmsRelayMessage(smsBody, decision.code);
    const result = await sendTextMessage({
      phoneNumberId: selfPhone,
      accessToken,
      to: selfChatId(selfPhone),
      text: message,
    });

    return NextResponse.json({
      forwarded: true,
      code: decision.code,
      messageId: 'messageId' in result ? result.messageId : null,
    });
  } catch (error) {
    console.error('[sms-relay] failed:', error);
    return NextResponse.json(
      { error: t('common.internalServerError') },
      { status: 500 }
    );
  }
}
