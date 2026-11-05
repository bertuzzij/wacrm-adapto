# Vários números no mesmo CRM (WAHA): projeto de texto

Este documento é **análise**, não implementação. Nada aqui foi escrito em
código. Existe para decidir, com os fatos na mão, como atender vários números
no fork antes de tocar em schema ou em motor de envio.

Cenário que motivou a análise: um número de referência atendido por vários
agentes na mesma estrutura (mesmos contatos, conversas, funil), e outro número
isolado, com logins que não enxergam o primeiro.

---

## Resposta curta

**Não precisa de um banco por número, e não precisa duplicar a aplicação.** Um
Supabase, um app, um deploy. A arquitetura já é multi-tenant por `account_id`;
o que falta é o número deixar de ser global e passar a ser um atributo da conta
— e, se o objetivo for alternar sem trocar de login, um vínculo
usuário↔conta que hoje não existe.

---

## O que já funciona hoje, sem uma linha de código

| Necessidade | Situação | Como |
| --- | --- | --- |
| Vários agentes no **mesmo** número | Funciona | Configurações → Equipe → convidar. Papéis `owner`/`admin`/`agent`/`viewer`; RLS via `is_account_member()` |
| Um número isolado de outro | Funciona | Contas distintas; toda tabela operacional tem `account_id` e política de RLS |
| Enxergar a mesma estrutura em equipe | Funciona | O convite move o `profiles.account_id` do convidado para a conta que convidou |

Procedimento para o número de referência hoje: cada agente cria cadastro
próprio (e-mail próprio) → um admin convida em Configurações → Equipe → o
agente aceita o link → vira `agent` e passa a ver exatamente a mesma base.

---

## Os quatro bloqueios reais

### 1. A sessão do WAHA é global de ambiente

`src/lib/whatsapp/waha.ts:32-34` lê a sessão de `process.env.WAHA_SESSION`
(padrão `"default"`). O valor é usado em **10 pontos** do arquivo
(linhas 122, 151, 276, 304, 321, 347, 373, 388, 392, 504) — envio de texto,
mídia, reação, "digitando", visto, download e listagem.

E o número é **descartado** no caminho de envio: `meta-api.ts:429` chama
`wahaSendText({ to, text, replyTo })` — o `phoneNumberId` que a camada de
acima conhece não é repassado.

**Consequência concreta:** com duas contas separadas, as duas enviam pela
mesma sessão. A conta 2 receberia as mensagens pelo webhook certo e
responderia **com o número da conta 1**. Isso não é um detalhe de refino; é a
razão pela qual "cada conta no seu número" ainda não é verdade.

### 2. `whatsapp_config` aceita um número por conta

`UNIQUE(account_id)` desde a migração `017_account_sharing.sql`. Uma linha por
conta. O `whatsapp_config` é o que dá ao webhook a rota `phone_number_id →
account_id` (`webhook/route.ts:354-357`).

### 3. `conversations` aceita uma conversa por contato na conta

`idx_conversations_account_contact` (migração `036`): `UNIQUE(account_id,
contact_id)`. Se dois números da mesma conta falarem com o mesmo contato, as
duas conversas colidem na mesma linha.

### 4. Um usuário pertence a uma conta só

`profiles.account_id` é coluna única. Pior: `redeem_invitation` **recusa**
entrar numa segunda conta — `019_invitation_rpcs.sql:187`:

> `You are already in a shared account; sign up with a different email to join this one`

E em `019_invitation_rpcs.sql:210` recusa também quem já tem dados na
conta própria:

> `Your account already contains data; sign up with a different email to join this one`

Ou seja: hoje **não existe** alternar entre contas.

---

## Um detalhe que a implementação precisa resolver primeiro

O webhook WAHA **não usa a sessão para rotear**. O campo `event.session` está
declarado em `waha-webhook/route.ts:81` e nunca é lido.

Hoje a rotação funciona porque o número vem de dentro do evento:
`toMetaBody` monta `phone_number_id` a partir de `event.me.id`
(`waha-webhook/route.ts:278-279`), e o handler Meta resolve a conta por esse
valor. Ou seja: **já funciona para vários números**, desde que cada número
tenha uma linha em `whatsapp_config` com o `phone_number_id` correto.

O que continua errado é só a **saída** (bloqueio 1). Receber de vários números
já funciona; responder por vários números, não.

Esse é o motivo de o primeiro passo ser pequeno: o problema de entrada está
resolvido, o de saída é localizado.

---

## Caminhos, do mais barato ao mais caro

### Caminho A — Sessão WAHA por conta

**O que resolve:** cada conta passa a ter o seu número de verdade, na entrada
e na saída. Conta 1 com equipe + Conta 2 isolada, cada uma no seu número.

**Mudanças:**

| # | Onde | O que |
| --- | --- | --- |
| 1 | migração nova | `whatsapp_config.waha_session TEXT` + `UNIQUE(account_id, waha_session)` no lugar de `UNIQUE(account_id)` |
| 2 | `waha.ts` | as 10 chamadas passam a receber a sessão por parâmetro, com `wahaSession()` só como fallback |
| 3 | `meta-api.ts` | as assinaturas de envio repassam a sessão da conta |
| 4 | `whatsapp_config` (rota + painel) | campo para salvar a sessão; hoje quem digita é `docs/waha.md` |
| 5 | `waha-webhook` | usar `event.session` para conferir que a sessão emissora é a da conta (defesa em profundidade) |

**Não mexe em:** `conversations`, RLS, modelo de membros, motor de automações.

**Custo:** médio. Uma migração, um fio a passar por ~10 funções, um campo de
tela.

### Caminho B — Vários números na mesma conta, com seletor na inbox

**O que resolve:** dois números rodando ao mesmo tempo, um único login, e
histórico separado por canal com seletor na tela.

**Além do A:**

- `whatsapp_config` passa a aceitar N linhas por conta (remove o
  `UNIQUE(account_id)`), com um `id` de canal.
- `conversations` ganha `channel_id` e a unicidade vira
  `(account_id, channel_id, contact_id)`.
- Seleção de "número ativo" na inbox, e o envio passa a levar o canal.
- Automações e fluxos passam a ser escopados por canal, ou declaram em qual
  canal disparam — hoje eles assumem "o número da conta".

**Custo:** alto. Mexe na chave de `conversations`, que é o coração do inbox e
do dashboard.

### Caminho C — Seletor de contas de verdade

**O que resolve:** o modelo que você descreveu, idêntico ao WhatsApp.

**Além do B:**

- tabela de vínculos `account_members` (substitui `profiles.account_id`);
- relaxar `idx_accounts_one_per_owner` (017);
- reescrever `redeem_invitation` para permitir múltiplos vínculos;
- seletor de conta no cabeçalho + troca de contexto no cliente;
- **revisar todas as políticas de RLS** que hoje leem `profiles.account_id`;
- revisar `is_account_member()`.

**Custo:** muito alto, e é o único caminho que toca RLS de ponta a ponta —
isto é, o de maior risco para uma instalação em produção.

---

## Recomendação

**Comece pelo Caminho A.** Ele entrega o que o cenário pede (um número com
equipe, outro isolado, cada um no seu telefone) sem tocar em RLS nem na chave
de `conversations` — que é onde estão os dois maiores riscos.

Só vá para o B quando a dor for **"os dois números precisam rodar ao mesmo
tempo no mesmo login, com histórico separado na mesma tela"**. Para "atender
números diferentes em contextos diferentes", o A basta e é ordens de grandeza
mais barato.

O C só se justifica se você quiser de fato alternar entre contas sem trocar de
login — e aí o pré-requisito é aceitar mexer em RLS com testes de regressão
por conta.

---

## Ordem de execução sugerida (quando for a hora)

1. **Sessão na configuração** — migração da coluna `waha_session`, sem mudar
   comportamento: o fallback continua `WAHA_SESSION`. Nada quebra.
2. **Fio da sessão no envio** — passar o parâmetro pelas 10 chamadas, com
   teste provando que a sessão da conta chega ao WAHA.
3. **Campo no painel** — gravar a sessão junto com o resto da configuração.
4. **Prova em produção** — duas contas, dois números, enviar e receber em cada.
5. Só então avaliar B ou C.

Cada passo é um commit, e cada um é reversível sozinho.

---

## Armadilhas a evitar

- **Não criar uma tabela `whatsapp_config_2`** nem "um banco por número".
  Quebra RLS, dashboard e todas as queries que assumem `account_id`, e produz
  o pior tipo de fork: divergente e impossível de sincronizar com o upstream.
- **Não trocar `UNIQUE(account_id)` por nada** antes de o envio saber a
  sessão. Sem a saída corrigida, um segundo número só cria confusão.
- **Não mexer em `is_account_member()`** no Caminho A: ele não é o gargalo e é
  usado por praticamente toda política de RLS do banco.
- **Lembrar do webhook exempto de sessão**: `/api/whatsapp/waha-webhook` está
  em `PUBLIC_WEBHOOK_PATHS` (`src/middleware.ts`). Uma rota nova de webhook
  precisa entrar nessa lista.

---

## Perguntas em aberto (precisam de resposta antes de implementar)

1. Os dois números falam com o **mesmo conjunto de clientes**? Se sim, o
   Caminho B é obrigatório; se não, o A resolve.
2. Os agentes precisam ver os dois números **ao mesmo tempo**, ou cada um
   atende um número por vez?
3. O número isolado é de outro **negócio** (CNPJ/marca diferente) ou do mesmo
   negócio com outro propósito?
4. Quem é `owner` de cada conta, e quantos agentes cada uma terá?
