# Briefing para uma nova sessão de IA

Este arquivo existe para que **qualquer sessão nova** (outro chat, outra máquina, outro
modelo) saiba o que já foi construído neste fork **antes de tocar em qualquer coisa** —
e, principalmente, para que não tente "melhorar", refatorar ou reformatar o que já
funciona e está em produção.

Cole o bloco da seção [Prompt de abertura](#prompt-de-abertura-para-colar) no início da
nova sessão. O resto do arquivo é a referência que ele deve consultar.

> **Regra zero:** este repositório roda **em produção** para um cliente real, com
> WhatsApp conectado e mensagens de verdade. Uma sessão nova não é um projeto greenfield.

---

## Prompt de abertura para colar

Copie do bloco abaixo. Ele é autossuficiente: aponta os arquivos que a sessão deve ler
antes de agir e lista as proibições.

```text
Você vai trabalhar no repositório E:\ProjectsDev\Zed\CRMWhats\wacrm — um FORK em
produção do wacrm (ArnasDon/wacrm), usado como CRM de WhatsApp real por um cliente.

ANTES DE ESCREVER QUALQUER CÓDIGO, leia estes arquivos, nesta ordem:
  1. docs/briefing-nova-sessao.md   (o contexto completo que você precisa)
  2. src/adapto/README.md           (a regra de onde o código novo pode morar)
  3. docs/seguranca-fork.md         (segredos, sincronização com upstream, push)
  4. AGENTS.md                      (aviso sobre a versão do Next.js)
  5. CONTRIBUTING.md                (estilo de commit que o upstream espera)

Fatos que você NÃO deve redescobrir nem contrariar:
  - origin   = github.com/bertuzzij/wacrm-adapto (PÚBLICO — todo commit é público)
  - upstream = github.com/ArnasDon/wacrm (somente leitura; push desabilitado de propósito)
  - branch de trabalho: main. Não existe branch de feature.
  - 19 commits nossos vivem sobre o upstream. Sempre confira:
        git log --oneline upstream/main..main
  - O app roda em Docker num homelab; a VPS faz o túnel. Deploy NÃO é `git push`:
    é build de imagem + transferência + `docker compose up -d --force-recreate`.

PROIBIDO sem autorização explícita:
  - rodar `npm run format` ou `npm run format:check` e "consertar" o resultado
  - reformatar, reordenar imports ou trocar aspas/crase em arquivos existentes
  - reescrever histórico (rebase, force-push, amend de commit já publicado)
  - `git push --force` em qualquer circunstância
  - commitar arquivos .env, chaves, QR, ou valores de segredo
  - apagar/recriar arquivos do upstream "para limpar"
  - alterar o comportamento de `wait_for_reply` no motor de automações
  - mudar `src/adapto/**` para dentro de arquivos do upstream

FLUXO OBRIGATÓRIO ao terminar uma mudança:
  npm run typecheck          # tsc --noEmit, deve sair 0
  npx vitest run             # 1835 passando + 3 falhas CONHECIDAS em currency.test.ts
  npm run build              # deve gerar .next/standalone/server.js
  node scripts/check-secrets.mjs   # deve sair 0; se bloquear, NÃO use --no-verify
  git add -A && git commit -F <arquivo> && git push origin main

  Se o build falhar com código -1073741819 (0xC0000005), é um crash conhecido do
  Node no Windows: rode de novo antes de investigar.

FORMATO DE COMMIT (ver a seção "Formato de commit" deste briefing):
  - primeira linha: verbo no imperativo, primeira letra MAIÚSCULA, sem ponto final,
    até ~72 caracteres (ex.: "Fix the crash: one realtime subscription for the count")
  - corpo: explica o PORQUÊ, não o quê (o diff já mostra o quê)
  - escreva em inglês (o upstream é em inglês; o produto é em português)
  - commits nossos NÃO usam prefixo convencional (feat:/fix:), com raras exceções
  - grave a mensagem num arquivo UTF-8 sem BOM e use `git commit -F`

Se algo que você encontrar contradizer este briefing, PARE e pergunte. Não presuma
que o briefing está velho nem que o código está errado — verifique qual dos dois mudou.
```

---

## O que é este projeto

Um fork do **wacrm** (CRM de WhatsApp em Next.js) adaptado para:

| Adaptação | Onde vive |
| --- | --- |
| WAHA como provedor de WhatsApp (no lugar da Meta Cloud API) | `src/lib/whatsapp/waha.ts`, `src/lib/whatsapp/waha-reply.ts` |
| Painel de conexão WAHA + QR | `src/adapto/waha-connection/` |
| Marca própria "AdaptoConect", pt-BR como padrão | `src/adapto/brand.ts`, `messages/pt.json` |
| Importação de nome/foto de contato | `src/adapto/contact-sync/` |
| Sino de não-lidas, status, toasts | `src/adapto/inbox/` |
| Botões/lista interativos com fallback para enquete/texto | `src/adapto/waha-interactive/` |

**Ambiente de produção:** conta individual com **1 pessoa** no papel `owner`.
Instância WAHA: tier **CORE**, engine **GOWS**.

> Detalhes de infraestrutura (domínio, IPs, hostname, UUIDs de conta) **não estão
> neste arquivo de propósito** — o `origin` é público. Se precisar deles para operar,
> peça ao dono do repositório ou consulte o `.env.local` local, que não é versionado.

---

## Regra de ouro: onde o código novo pode morar

Um fork que sincroniza com o upstream sobrevive de manter o diff pequeno. Nesta ordem
de preferência:

1. **Arquivo novo em `src/adapto/`** — zero conflito.
2. **Ponto de extensão que o upstream já prevê** (ex.: `isWahaMode()`) — zero conflito.
3. **Edição mínima num arquivo do upstream** — conflito baixo, mas real.

Medido hoje: **75 arquivos, +7814/−167 linhas** contra o upstream. Fora de
`src/adapto/`, `messages/`, `docs/` e `scripts/`, são **44 arquivos**. Toda edição em
arquivo do upstream deve ter motivo e ser mínima.

Comando para ver o que é só seu:

```bash
git fetch upstream
git log --oneline upstream/main..main
git diff --stat upstream/main...main
git diff --stat upstream/main...main -- . ':(exclude)src/adapto' ':(exclude)messages'
```

---

## Formato de commit

Fonte: `CONTRIBUTING.md` do upstream, linha 90 — *"Commit-message first line is
imperative + terse; the body explains the why, the diff shows the what."*

### O padrão dos 19 commits deste fork

Primeira linha **imperativa, descritiva, sem prefixo**, capitalizada, sem ponto final:

```
Keep running later automation steps when one step fails
Fix the broken add-tag step, and split the bell by source
Fix the crash: one realtime subscription for the unread count
Surface unread conversations in the header, and stop hiding the badge
Send interactive messages as native lists, not polls
Delete conversations, keeping linked deals
```

| Regra | Detalhe |
| --- | --- |
| Idioma | **Inglês** no commit; **português** no produto e nos comentários de código |
| Prefixo convencional | **Só 1 de 19** usa (`docs:`). O upstream usa `fix(...)`, mas nós usamos frase imperativa |
| Primeira linha | Imperativa, capitalizada, sem ponto final, **≤ 72 caracteres** (medido: média 59, máximo 71) |
| Corpo | Explica **por que** a mudança existe; cita sintomas do usuário, causa raiz, e o que foi descartado |
| Linha em branco | Obrigatória entre título e corpo |
| Rodapé | Não usado (sem `Co-Authored-By`, sem emoji) |

### Como gravar (Windows)

O `git commit -m` com texto multilinha quebra acentuação no PowerShell. Use arquivo:

```powershell
$lines = @(
'Imperative title of the change',
'',
'Why this exists. Describe the symptom the user saw, then the root cause.',
'',
'What changed, and what was deliberately NOT changed.'
)
[IO.File]::WriteAllText("$env:TEMP\commit.txt", (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
git commit -F "$env:TEMP\commit.txt"
```

### Corpo: o que vale a pena escrever

Bom corpo de commit neste projeto cita:

- o **sintoma relatado** (ex.: "a automação não envia a lista")
- a **causa raiz** medida, com evidência (código de erro do banco, log, status HTTP)
- o **que foi descartado** e por quê (evita que a próxima sessão repita o caminho)
- **qualquer exceção deliberada** à regra nova

Exemplo real (commit `6fb5e12`), que documenta até uma hipótese errada:

```
Both reports came from the same root cause, and it was not the tag at all.

Tag creation was failing with 23502: `tags.user_id` is NOT NULL with no
default, and the builder only sent account_id + name. [...]

The bigger bug: the step loop had `break` in its catch, so ONE failing
step aborted the whole automation. [...]

One deliberate exception: a failing `wait_for_reply` still stops the run.
```

### O que NUNCA entra num commit

- Segredo, token, chave, QR, connection string — ver `docs/seguranca-fork.md`
- Arquivos `.env*` (o `.gitignore` já cobre, mas confira)
- `package-lock.json` sem motivo
- uma reformatação massiva "de passagem" (afoga o diff real e cria conflito com o upstream)

---

## A armadilha do Prettier (leia antes de rodar `npm run format`)

**`npm run format` reescreveria ~600 arquivos.** Não rode.

O motivo: o `.prettierrc` pede `semi: true` e `singleQuote: true`, mas o código do
upstream (e o nosso, por convenção) é escrito **sem ponto e vírgula e com aspas
duplas**. Medido em 2026-11-05:

```
599 arquivos fora do padrão do .prettierrc
576 deles NÃO estão em src/adapto (ou seja, são do upstream)
```

(O número cresce a cada arquivo novo — inclusive este briefing entra na conta. O que
importa é a proporção: a esmagadora maioria do repositório nunca passou pelo Prettier.)

Ou seja: a configuração nunca foi aplicada ao repositório, nem pelo upstream. Rodar
`format` agora produziria um diff de ~600 arquivos, destruindo a separação "o que é
nosso / o que é do upstream" e garantindo conflito no próximo merge.

**Regra prática:** escreva o código novo no mesmo estilo do arquivo ao redor — sem
`;`, com aspas duplas nos `.tsx` do upstream, seguindo o que já existe. O
`typecheck` e o `vitest` são os portões de qualidade reais; o Prettier não é.

Se em algum momento formos padronizar de verdade, isso é um commit próprio, isolado,
decidido pelo dono do repositório — nunca um efeito colateral.

---

## Pipeline de qualidade e deploy

### Portões, na ordem

```bash
npm run typecheck                  # tsc --noEmit → 0
npx vitest run                     # 1835 passando; 3 falhas conhecidas
npm run build                      # gera .next/standalone/server.js
node scripts/check-secrets.mjs     # 0 = liberado; bloqueou? descubra o motivo
```

**Falhas de teste conhecidas e aceitas (não conserte sem pedir):**

- `src/lib/currency.test.ts` — 3 falhas: formatação pt-BR (`Intl.NumberFormat`)
  devolve `US$ 1.234` e o teste espera `1,234`. É pré-existente do upstream.
- `src/i18n/icu-safety.test.ts` — instável em suíte completa, passa isolado.

**Crash de build conhecido:** `npm run build` no Windows às vezes termina com
`-1073741819` (`0xC0000005`) e não gera `standalone/server.js`. Rode de novo; sempre
passou na segunda tentativa.

### O pre-commit de segredos

Instalado via `npm install` (`prepare` → `scripts/install-hooks.mjs`). Ele bloqueia o
commit quando encontra o valor literal de qualquer variável do `.env.local`, ou um
formato de alta confiança (JWT do Supabase, token de túnel Cloudflare, `AKIA…`,
`ghp_…`, `sk-…`, bloco de chave privada).

Duas consequências práticas:

1. **UUID hexadecimal literal em teste é falso positivo** — o padrão de "tunnel id do
   Cloudflare" casa com qualquer UUID `8-4-4-4-12`. Monte o valor em runtime
   (`['11111111','1111','4111','8111','111111111111'].join('-')`) em vez de escrever
   o literal.
2. **Nunca use `git commit --no-verify`.** Se o hook bloqueou, descubra o que ele viu.
   A saída dele mostra o arquivo e o nome da variável — nunca o valor.

### Deploy (não é `git push`)

O `git push origin main` publica o **código**. O **app em produção** só muda com um
novo build de imagem:

```powershell
# 1. build com os NEXT_PUBLIC_* como build args (são inlinados em build time)
#    NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#    NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_APP_LOCALE=pt
docker build ... -t wacrm-app:latest .

# 2. exportar e transferir
docker save wacrm-app:latest -o wacrm.tar   # ~88 MB comprimido

# 3. na máquina que hospeda os containers (o "homelab")
docker tag wacrm-app:latest wacrm-app:previous   # mantém rollback
docker load -i wacrm.tar
docker compose up -d --force-recreate
```

Topologia de produção (valores omitidos de propósito):

```
VPS pública  →  domínio atrás de Cloudflare  →  túnel
   →  máquina dos containers (LAN privada)  →  127.0.0.1:3100  →  container `wacrm`
```

A porta 3100 é publicada em `127.0.0.1` apenas (`HOST_BIND`/`HOST_PORT` no
`.env.local` do servidor), para que só o proxy reverso local alcance o app.
Dentro do container o app sempre escuta em `3000` — o `docker-compose.yml` fixa
`PORT: 3000` justamente para um `PORT` perdido no `.env.local` não dessincronizar
a porta da healthcheck.

Os IPs, o domínio e o hostname reais ficam no `.env.local` e na configuração do
servidor — **não os escreva aqui nem em qualquer arquivo versionado.**

**Verificação de que o deploy pegou:** compare o MD5 de um chunk dentro do container
com o do build local. Os IDs de imagem divergem após `save`/`load`, então comparar
`docker images` não prova nada.

```bash
docker exec wacrm md5sum '/app/.next/server/chunks/<arquivo>.js'
```

Código de servidor vive em `/app/.next/server/chunks/`; código de cliente em
`/app/.next/static/chunks/`. Comentários são removidos pelo minificador — não procure
por eles no bundle.

---

## Migrações de banco

Pasta `supabase/migrations/`, aplicadas em ordem de nome por
`node scripts/apply-migrations.mjs` (registra em
`supabase_migrations.schema_migrations`; use `--dry-run` para listar).

**Risco de colisão de numeração.** O upstream está em `059_dashboard_overview.sql`;
nós usamos `060_contact_sync_fields.sql` e `061_contact_avatars_bucket.sql`. Se o
upstream publicar um `060_*`, o merge traz dois arquivos com o mesmo prefixo —
ordem indefinida e falha silenciosa.

**Regra:** antes de criar migração nova, rode `git fetch upstream` e confira o maior
número **no upstream**. Se houver sobreposição, renomeie a nossa para o próximo
número livre. Migração já aplicada em produção **não se renomeia** — mas migração
ainda não aplicada, sim.

---

## Decisões de produto já tomadas (não reverta)

Estas foram escolhas conscientes, não acidentes:

| Decisão | Por quê |
| --- | --- |
| `reconnect()` nunca faz logout da sessão WAHA | Deslogar derruba o pareamento; o usuário teria de escanear o QR de novo |
| `forcePairing()` só atrás de confirmação | Gera QR novo e pode derrubar a sessão ativa |
| Métricas mostram `null` → "sem dado", nunca `0` | `0` mente: significa "medi e deu zero", não "não medi" |
| `name_source = 'manual'` é intocável | Nome editado à mão pelo usuário nunca é sobrescrito pela sincronização |
| Sincronização é mão única (WhatsApp → CRM) | O WAHA é a fonte da verdade; o CRM não escreve de volta no perfil do WhatsApp |
| Deals sobrevivem à exclusão da conversa | O negócio é registro comercial; a conversa é o histórico de mensagens |
| Um passo de automação com falha **não** aborta os seguintes | Antes abortava, e escondia a causa real (bug relatado em produção) |
| Exceção: `wait_for_reply` com falha **para** a execução | Os passos seguintes só devem rodar depois da resposta do contato |
| `tag_id` de automação é FK, sempre UUID | Aceitar nome digitado gerou automação que falhava em toda execução |
| Canal de realtime do Supabase tem nome único por instância | Nome fixo + dois consumidores = crash da página inteira |

---

## Armadilhas técnicas já pagas

- **Next.js:** este projeto usa uma versão com mudanças de API. Leia
  `node_modules/next/dist/docs/` antes de escrever código (aviso do `AGENTS.md`).
- **Supabase Realtime:** `supabase-js` deduplica canais **pelo nome**. Dois `.on()` no
  mesmo nome depois de `subscribe()` lança erro e derruba a página. Use `useId()` no
  nome, e mantenha uma única subscription por tabela num provider.
- **`tags`:** `user_id` é **NOT NULL sem default**. INSERT só com `account_id` +
  `name` falha com `23502`.
- **WAHA engine GOWS:** `/api/sendList` → 201; `/api/sendButtons` → **501**. O
  fallback existente reenvia botões como lista de uma seção — é intencional.
- **PowerShell no Windows:** `Invoke-WebRequest` pede credencial de proxy; use
  `curl.exe`. Comandos nativos que escrevem em stderr retornam `[exit code: 1]` mesmo
  tendo sucesso — leia a saída antes de tratar como falha.
- **`git push`** reporta `[exit code: 1]` no PowerShell mesmo com sucesso; confirme
  pela linha `...  main -> main`.
- **Scripts `.mjs`** que importam `pg` precisam morar em `wacrm/scripts/` — fora
  dali o módulo não resolve.

---

## Se for sincronizar com o upstream

```bash
git fetch upstream
git log --oneline upstream/main..main     # o que é seu
git merge upstream/main                   # traz as correções
npx vitest run && npm run typecheck       # valide o merge
git push origin main
```

Configurações que economizam tempo (já recomendadas em `docs/seguranca-fork.md`):

```bash
git config rerere.enabled true
git config merge.conflictstyle zdiff3
```

O `upstream` tem push **desabilitado** de propósito. Sempre `git push origin`.
