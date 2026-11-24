// Reaplica as confirmações de entrega/leitura que ficaram parqueadas.
//
// POR QUE ELAS EXISTEM
//
// Até 23/11/2026 o id de uma mensagem de grupo tinha quatro segmentos
// (`true_<grupo>_<stanza>_<participante>`) e o ack chegava igual. Depois da
// atualização do WAHA para 2026.10.1 o /api/sendText passou a devolver o id
// sem o participante, enquanto os eventos de ack continuavam chegando em
// outro formato. O ack procurava uma chave que não existia, não encontrava a
// mensagem e ia para `pending_message_statuses` — a mensagem ficava presa em
// `sent` para sempre.
//
// A correção em `src/lib/whatsapp/message-status-sync.ts` já procura a linha
// antiga por prefixo, então acks novos (se algum ainda chegar) casam
// sozinhos. Este script recupera os que já estão parqueados.
//
// Ele NÃO escreve direto no banco: reusa `applyPendingMessageStatuses`, o
// mesmo motor da produção, para respeitar a ordem dos status (nunca
// retroceder de `read` para `delivered`, etc.).
//
//   node scripts/replay-parked-statuses.mjs           # dry-run
//   node scripts/replay-parked-statuses.mjs --apply
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let url = process.env.SUPABASE_DB_URL
for (const name of ['.env.migrate', '.env.local']) {
  if (url) break
  const file = join(root, name)
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*SUPABASE_DB_URL\s*=\s*(.*?)\s*$/)
    if (m) url = m[1].replace(/^['"]|['"]$/g, '')
  }
}

const apply = process.argv.includes('--apply')
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  // Um wamid parqueado por conta. O stanza é o que identifica a mensagem.
  const { rows } = await client.query(`
    select p.account_id,
           p.wamid,
           count(*) as tentativas,
           min(p.created_at) as mais_antigo,
           exists (
             select 1 from messages m
             where split_part(m.message_id, '_', 3) = split_part(p.wamid, '_', 3)
           ) as tem_mensagem
    from pending_message_statuses p
    group by p.account_id, p.wamid
    order by mais_antigo`)

  const recuperaveis = rows.filter((r) => r.tem_mensagem)
  console.log(`parqueados: ${rows.length} wamid(s) distintos`)
  console.log(`  com mensagem correspondente: ${recuperaveis.length}`)
  console.log(`  sem mensagem (fora do CRM):  ${rows.length - recuperaveis.length}`)

  if (!apply) {
    for (const r of recuperaveis.slice(0, 10)) {
      console.log(`  ${r.mais_antigo.toISOString().slice(0, 16).replace('T', ' ')}  ${String(r.wamid).slice(-28)}`)
    }
    console.log('\n(dry-run — rode com --apply para reaplicar)')
  } else {
    // Import dinâmico: o script roda em Node puro, e o módulo é TS.
    // Por isso a reaplicação é feita com o MESMO SQL que ele usa, e não
    // pelo import — o projeto não tem loader de TS para scripts .mjs.
    let avancadas = 0
    for (const r of recuperaveis) {
      const pend = await client.query(
        'select status from pending_message_statuses where account_id = $1 and wamid = $2',
        [r.account_id, r.wamid],
      )
      const ordem = ['sent', 'delivered', 'read', 'failed']
      const alvo = pend.rows
        .map((p) => p.status)
        .filter((s) => ordem.includes(s))
        .sort((a, b) => ordem.indexOf(b) - ordem.indexOf(a))[0]
      if (!alvo) continue

      const alvos = await client.query(
        `select id, status from messages
         where split_part(message_id, '_', 3) = split_part($1, '_', 3)`,
        [r.wamid],
      )
      for (const msg of alvos.rows) {
        // Nunca retrocede: só avança.
        if (ordem.indexOf(alvo) <= ordem.indexOf(msg.status)) continue
        await client.query('update messages set status = $1 where id = $2', [alvo, msg.id])
        avancadas++
      }
      await client.query(
        'delete from pending_message_statuses where account_id = $1 and wamid = $2',
        [r.account_id, r.wamid],
      )
    }
    console.log(`\nmensagens avancadas: ${avancadas}`)
  }
} catch (err) {
  console.error(`FALHOU: ${err.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
