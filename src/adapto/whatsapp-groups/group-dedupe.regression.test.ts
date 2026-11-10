import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ============================================================
// Regressão: um grupo não pode virar vários contatos.
//
// Relato: "tenho alguns canais que nos enviam mensagens, e isso está
// chegando como mensagens diretas, cada mensagem no canal cai pra mim como
// uma conversa". Medido: 8 contatos e 6 conversas para o MESMO grupo.
//
// A causa era um ciclo: a migração 022 excluiu grupos do índice único de
// `phone_normalized` (para um JID de grupo não colidir com o telefone de
// uma pessoa), então o banco nunca impedia a duplicata. Com duplicatas
// presentes, `findContactByGroupKey` usava `.maybeSingle()`, que ERRA
// quando há mais de uma linha — a busca devolvia null, o webhook concluía
// "não existe" e inseria mais um.
//
// O teste do componente não pegaria isso: é uma interação entre um índice
// ausente e uma chamada de API que lança. O que dá para garantir de forma
// determinística é que a consulta NÃO usa o modo que falha na ambiguidade,
// e para isso o código-fonte precisa ser lido.
// ============================================================

const webhook = readFileSync(
  'src/app/api/whatsapp/webhook/route.ts',
  'utf8'
);

/** Corpo de `findContactByGroupKey`, sem comentários. */
function groupLookupBody(): string {
  const start = webhook.indexOf('async function findContactByGroupKey');
  expect(start).toBeGreaterThan(-1);
  const end = webhook.indexOf('\n}', start);
  return webhook
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('findContactByGroupKey', () => {
  it('não usa maybeSingle (lança quando há duplicatas)', () => {
    // Este é o bug exato: com 8 contatos, `.maybeSingle()` errava, a
    // função devolvia null e o webhook criava o nono.
    expect(groupLookupBody()).not.toContain('maybeSingle');
  });

  it('limita a uma linha explicitamente', () => {
    const body = groupLookupBody();
    expect(body).toContain('.limit(1)');
    // Ordenado para ser determinístico: com duplicatas, qual linha vem
    // não pode depender do plano de execução do Postgres.
    expect(body).toContain('.order(');
  });

  it('consulta pela chave inteira do grupo, não por phone_normalized', () => {
    // `phone_normalized` de `group:…` são "só os dígitos", que colidiriam
    // com o telefone de uma pessoa — o motivo de grupos terem ficado fora
    // do índice único em primeiro lugar.
    const body = groupLookupBody();
    expect(body).toContain(".eq('phone', groupKey)");
    expect(body).not.toContain('phone_normalized');
  });
});

describe('migração 070', () => {
  const sql = readFileSync(
    'supabase/migrations/070_one_contact_per_group.sql',
    'utf8'
  );

  it('cria o índice único que faltava para chaves de grupo', () => {
    expect(sql).toContain('idx_contacts_account_group_key');
    expect(sql).toContain("WHERE phone LIKE 'group:%'");
  });

  it('deduplica mensagens antes de mover (evita colisão no índice)', () => {
    // A primeira versão desta migração falhou em produção de teste com
    // "duplicate key value violates unique constraint
    // idx_messages_conversation_message_id": mover duas gravações do mesmo
    // evento para a mesma conversa colide. A deduplicação precisa vir
    // ANTES do UPDATE.
    const dedupe = sql.indexOf('DISTINCT ON (mm.message_id)');
    const move = sql.indexOf('SET conversation_id = k.id');
    expect(dedupe).toBeGreaterThan(-1);
    expect(move).toBeGreaterThan(-1);
    expect(dedupe).toBeLessThan(move);
  });

  it('preserva o contato mais antigo de cada grupo', () => {
    expect(sql).toContain('ORDER BY created_at ASC');
  });
});
