# Multi-conta no CRM: plano de implementação

**Documento de análise e plano.** Nada aqui foi implementado. Escrito em
2026-11-05, com todos os números verificados contra o código deste repositório.

Este documento responde a três perguntas:

1. Dá para rodar vários números no mesmo CRM, como um "tenant"?
2. Dá para um operador alternar entre contas, como no WhatsApp?
3. Se não der, preciso de duas aplicações e dois bancos?

---

## Resposta direta, antes dos detalhes

| Pergunta | Resposta |
| --- | --- |
| Precisa de dois bancos? | **Não.** Um Supabase serve todos os números. |
| Precisa de duas aplicações? | **Não.** Um deploy serve todos. |
| Dá para ter N números, cada um com sua equipe isolada? | **Sim, e uma parte já funciona hoje.** |
| Dá para um operador alternar entre contas no mesmo login? | **Sim, mas é o caminho mais caro** — e ele mexe nas 121 políticas de RLS. |

**Não existe "gambiarra" necessária em nenhum dos caminhos.** Mas existe uma
escolha entre barato-e-suficiente e caro-e-completo, e ela depende de uma
resposta sua (seção "Perguntas" no fim).

### O que muda tudo: o tenant já existe

O CRM **já é multi-tenant** no banco. As **15 tabelas de negócio** têm
`account_id` (`contacts`, `tags`, `custom_fields`, `contact_notes`,
`conversations`, `whatsapp_config`, `message_templates`, `pipelines`, `deals`,
`broadcasts`, `automations`, `automation_logs`, `automation_pending_executions`,
`flows`, `flow_runs`), e o isolamento é imposto por RLS. A pergunta não é "como
introduzir tenancy" — é "como deixar uma pessoa alcançar mais de uma".

(`profiles` também tem `account_id`, mas ela é a tabela de **membership**: é
justamente ela que amarra um usuário a uma conta, e é o bloqueio 4.)

---

## O que já funciona hoje, sem uma linha de código

| Necessidade | Estado | Evidência |
| --- | --- | --- |
| Vários agentes no **mesmo** número, mesma estrutura | **Funciona** | convite em Configurações → Equipe; `redeem_invitation` move `profiles.account_id` |
| Um número totalmente isolado de outro | **Funciona** | contas distintas + RLS por `is_account_member` |
| Papéis (`owner`/`admin`/`agent`/`viewer`) | **Funciona** | `account_role_enum`, 121 usos nas políticas |

Procedimento atual para montar a equipe do número de referência: cada agente
cria cadastro próprio → um admin convida → o agente aceita → vira `agent` na
sua conta. Isso resolve o seu caso de "outros agentes atendendo em um dos
números", hoje.

---

## O que NÃO funciona — e é isso que o plano resolve

### Bloqueio 1 — A sessão do WAHA é global (o mais grave)

`src/lib/whatsapp/waha.ts:32-34` lê a sessão de `process.env.WAHA_SESSION`,
padrão `"default"`. O valor é usado em **13 pontos** do arquivo (10 como
`session: wahaSession()` no corpo das requisições, e 3 embutidos na URL:
`wahaGetSession`, `wahaResolveLid`, `wahaGetChatPicture`, `wahaListChats`),
espalhados por **11 funções exportadas**.

Pior: o número é **descartado no envio**. `meta-api.ts:429` chama
`wahaSendText({ to, text, replyTo })` — o `phoneNumberId` que a camada de cima
conhece não é repassado a ninguém.

> **Consequência medida:** mesmo com duas contas separadas, as duas enviam pela
> mesma sessão. A conta 2 receberia mensagens pelo webhook certo e responderia
> **com o número da conta 1**. "Cada conta no seu número" ainda não é verdade.

### Bloqueio 2 — Um número por conta

`whatsapp_config` tem `UNIQUE(account_id)` (`017_account_sharing.sql:326`).
E `loadAccountMetaCredentials` (`src/lib/flows/meta-send.ts:52`) faz
`.single()` — se houvesse duas linhas, ele **lança erro**, não escolhe uma.

### Bloqueio 3 — Uma conversa por contato na conta

`idx_conversations_account_contact` (`036`): `UNIQUE(account_id, contact_id)`.
Dois números da mesma conta falando com o mesmo cliente colidem.

### Bloqueio 4 — Um usuário pertence a uma conta só

`profiles.account_id` é coluna única, `NOT NULL`, com `UNIQUE(user_id)` no
`user_id` (`001:22`). E `redeem_invitation` recusa a segunda conta
(`019_invitation_rpcs.sql:187`):

> `You are already in a shared account; sign up with a different email to join this one`

### Bloqueio 5 — `accounts_select` só mostra contas onde você é membro

`017:631` — `USING (is_account_member(id))`. Um seletor de contas não
conseguiria listar as outras contas do usuário sem alterar esta política.

---

## Fatos que reduzem muito o custo

Levantei estes pontos porque eles mudam a estimativa:

**1. O recebimento já funciona para N números.** `toMetaBody` monta o
`phone_number_id` a partir de `event.me.id` (`waha-webhook/route.ts:278-279`), e
o handler Meta resolve a conta por esse valor (`webhook/route.ts:354-357`). Ou
seja: **entrada já é multi-número**; só a saída está errada.

**2. O parâmetro `accountId` já atravessa as rotas de envio.**
`src/app/api/whatsapp/send/route.ts:39` já recebe `accountId` de
`requireRole('agent')` e o repassa. O conserto do bloqueio 1 é **passar a
sessão adiante**, não reescrever as chamadas.

**3. A tenancy não vem do JWT.** `is_account_member()` lê
`profiles WHERE user_id = auth.uid()` (`017:145-150`). Isso significa que, para
dar multi-conta a um usuário, é preciso mudar **um lugar** (`is_account_member`)
e a resolução do cliente em `use-auth.tsx:195` — não as 121 políticas.

**4. `account_id` aparece 29 vezes no código de aplicação** (fora testes).
É o tamanho real do "fio a passar", não 121.

---

## Os três caminhos

### Caminho A — Sessão WAHA por conta

**Entrega:** cada conta no seu próprio número, na entrada e na saída. Equipe
compartilhada numa conta, número isolado em outra. **Sem seletor de contas.**

| # | Onde | O que |
| --- | --- | --- |
| 1 | migração | `whatsapp_config.waha_session TEXT`; trocar `UNIQUE(account_id)` por `UNIQUE(account_id, waha_session)` |
| 2 | `waha.ts` | as 13 ocorrências (11 funções) recebem a sessão por parâmetro; `wahaSession()` vira fallback |
| 3 | `meta-api.ts` | as assinaturas de envio repassam a sessão da conta |
| 4 | `whatsapp_config` rota + painel | campo para salvar a sessão |
| 5 | `waha-webhook` | conferir `event.session` contra a sessão da conta (defesa em profundidade) |

**Não toca em:** RLS, `conversations`, `is_account_member`, modelo de membros.
**Custo:** médio. **Risco:** baixo.
**Resolve o seu cenário?** Sim, se "outro número isolado" puder ser outra conta
com outro login.

### Caminho B — Vários números na mesma conta

**Entrega:** dois números rodando ao mesmo tempo, um login, seletor na inbox.

**Além do A:**
- `whatsapp_config` passa a ter N linhas por conta (remove `UNIQUE(account_id)`).
- `conversations` ganha `channel_id`; unicidade vira `(account_id, channel_id, contact_id)`.
- `loadAccountMetaCredentials` deixa de usar `.single()` e passa a receber o canal.
- Automações e fluxos ganham canal explícito (hoje assumem "o número da conta").
- Seletor de canal na inbox.

**Não toca em:** RLS, modelo de membros.
**Custo:** alto. **Risco:** médio-alto (mexe na chave de `conversations`, que é
o coração do inbox e do dashboard).

### Caminho C — Seletor de contas, como no WhatsApp

**Entrega:** o que você descreveu. Um login, alterna entre contas.

**Além do A (não precisa do B):**
- `profiles.account_id` deixa de ser a fonte de verdade → nova tabela
  `account_members (user_id, account_id, role)`.
- `is_account_member()` passa a ler a nova tabela (e a considerar a conta
  **ativa** da sessão).
- `accounts_select` (`017:631`) passa a listar todas as contas do usuário.
- `handle_new_user()` e `redeem_invitation()` reescritos para permitir múltiplos
  vínculos (hoje recusam).
- `idx_accounts_one_per_owner` relaxado.
- Um "tenant ativo" por sessão: JWT claim via `app_metadata` (servidor decide),
  nunca `user_metadata` (o usuário edita).
- Seletor no cabeçalho + troca de contexto no cliente (`use-auth.tsx`).

**Custo:** alto. **Risco:** alto — é o único caminho que toca autenticação e a
função usada por **121 políticas**. Cada política precisa ser re-testada.

---

## Comparação

| | A | B | C |
| --- | --- | --- | --- |
| Cada conta no seu número | ✅ | ✅ | ✅ |
| Vários números na mesma conta | ❌ | ✅ | ❌ |
| Equipe compartilhada | ✅ | ✅ | ✅ |
| Alternar contas sem novo login | ❌ | ❌ | ✅ |
| Toca RLS / `is_account_member` | ❌ | ❌ | **✅ (121 usos)** |
| Toca a chave de `conversations` | ❌ | **✅** | ❌ |
| Migrações | 1 | 3–4 | 4–5 |
| Commits estimados | 4–5 | 10–14 | 12–18 |
| Risco em produção | baixo | médio-alto | alto |

---

## Recomendação

**Comece pelo A. Ele resolve o cenário descrito sem tocar em RLS nem em
`conversations` — os dois pontos onde um erro quebra dados de cliente.**

O seu cenário ("número de referência com equipe + outro número isolado") é
atendido pelo A **hoje**, usando o fluxo de convite que já existe. A única
coisa que o A acrescenta é a saída correta por número.

**Vá para o C só se a dor real for "não quero trocar de login".** Se for esse
o caso, avise: o C é viável e não exige dois bancos, mas é uma obra de várias
sessões com risco concentrado na autenticação.

**O B é o menos provável de valer a pena** neste cenário: ele existe para
quando os dois números atendem **os mesmos clientes** e precisam de histórico
unificado. Se não for isso, o B cobra caro por um problema que você não tem.

---

## Plano de execução do Caminho A (passo a passo)

Cada passo é um commit independente e reversível sozinho.

### Passo 1 — Coluna da sessão, sem mudar comportamento
`supabase/migrations/063_whatsapp_config_session.sql`:
```sql
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS waha_session TEXT;
-- preenche a linha existente com a sessão em uso
UPDATE whatsapp_config SET waha_session = 'default' WHERE waha_session IS NULL;
```
O código continua lendo `WAHA_SESSION` do ambiente (fallback). **Nada muda em
produção.** Migração idempotente, no próximo número livre (`062` é a nossa
última; o upstream para em `059`).

### Passo 2 — Fio da sessão no envio
`waha.ts`: as **13 ocorrências** (em 11 funções) ganham `session?: string`, com
`wahaSession()` como fallback. `meta-api.ts` repassa. Teste novo provando que a
sessão da conta chega ao WAHA (mock de `fetch`, sem rede).

### Passo 3 — Ler a sessão da conta
`loadAccountMetaCredentials` e o caminho de envio passam a buscar
`waha_session` junto de `phone_number_id`/`access_token`. Fallback no ambiente
para linhas antigas.

### Passo 4 — Painel e rota
Campo de sessão em Configurações → Conexão WAHA, gravado em
`whatsapp_config`. Validação: string não vazia, sem espaços.

### Passo 5 — Defesa em profundidade no webhook
Conferir `event.session` contra a sessão configurada da conta; divergência vai
para log, não derruba o evento (evita perder mensagem por configuração errada).

### Passo 6 — Prova em produção
Duas contas, dois números: enviar e receber em cada uma, conferindo que o
remetente é o número certo. Rollback = imagem `previous`.

---

## Riscos e como cada um é mitigado

| Risco | Mitigação |
| --- | --- |
| `UNIQUE(account_id)` removido e duas linhas confundirem o código | só no Caminho B; no A a constraint vira `UNIQUE(account_id, waha_session)` |
| `loadAccountMetaCredentials` com `.single()` estourando | no A continua havendo **uma** linha por conta; `.single()` segue correto |
| Mensagem perdida por sessão errada | fallback para `WAHA_SESSION` quando a coluna está nula |
| Duas contas na mesma sessão WAHA por engano | `waha_session` única por conta + log quando `event.session` divergir |
| Regressão em automações | o motor já é escopado por `account_id` (`engine.ts:88,111,129`); nada muda |
| `wait_for_reply` | **não é tocado** em nenhum passo (proibido pelo briefing) |

---

## Erro a evitar

**Não criar "um banco por número" nem `whatsapp_config_2`.** Isso quebra RLS,
o dashboard e todas as queries que assumem `account_id`, e produz o pior tipo
de fork: divergente e impossível de sincronizar com o upstream. O modelo
correto para este produto é **um banco, `account_id` em tudo, RLS por
membership** — que é exatamente o que já existe.

---

## Perguntas que precisam de resposta antes de implementar

1. **Os dois números atendem os mesmos clientes?**
   - Não → Caminho A basta. *(recomendado)*
   - Sim → precisa do B (histórico separado por canal).
2. **Você precisa alternar entre contas sem trocar de login?**
   - Não → A resolve.
   - Sim → C, e o orçamento de risco sobe.
3. O número isolado é de **outro negócio** (CNPJ/marca) ou do mesmo?
4. Quantos agentes em cada conta, agora e em 6 meses?

Com as respostas 1 e 2 eu fecho o escopo e começo pelo Passo 1, que é o único
que não muda comportamento nenhum.

---

## Referências

- Skill `multi-tenant-architecture` (mblode/agent-skills, 1,8 mil instalações),
  carregada nesta sessão. O modelo recomendado por ela — *shared schema com
  `tenant_id` + RLS* — é o que este projeto já usa.
- `docs/multi-waba.md` (upstream): o equivalente deste documento para a Meta.
- Migrações: `001` (schema), `017` (contas/RLS), `019` (convites), `036`
  (unicidade de conversas).
