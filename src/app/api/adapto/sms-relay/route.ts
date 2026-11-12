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
    // Aceita DOIS formatos, porque a vida real mandou os dois:
    //
    //   1. JSON:  {"body": "<texto do sms>"}   — o formato canônico
    //   2. Cru:   o próprio texto do SMS
    //
    // O formato cru existe porque o placeholder de variável do app do
    // celular provou ser uma armadilha: MacroDroid usa `[sms_text]`, SMS
    // Forwarder usa `{sms_text}`, e uma versão errada chega ao servidor
    // como o LITERAL da variável (10 bytes, três testes seguidos). Recusar
    // isso transforma um erro de configuração do app em código não
    // entregue — o pior resultado para a necessidade original (receber o
    // 2FA longe do celular).
    //
    // A regra de decisão (`shouldForwardSms`) é a mesma nos dois caminhos:
    // só passa o que casa com o padrão da Amplimed. Aceitar corpo cru não
    // abre a porta para SMS alheio — abre para o MESMO filtro.
    // ------------------------------------------------------------
    let smsBody = '';
    let parseNote: string;
    try {
      const parsed = JSON.parse(rawBody) as {
        body?: string;
        from?: string;
        timestamp?: string;
      } | null;
      smsBody = typeof parsed?.body === 'string' ? parsed.body : '';
      parseNote = 'json';
    } catch {
      // Não é JSON: trata o corpo inteiro como o texto do SMS. Só faz
      // sentido se houver conteúdo; um corpo vazio não decide nada.
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
