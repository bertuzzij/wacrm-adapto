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
  - Existe um conjunto de commits nossos sobre o upstream. NÃO decore o número —
    ele muda a cada commit. Descubra com:
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
  npx vitest run             # todos passando + 3 falhas CONHECIDAS em currency.test.ts
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

### O padrão dos commits deste fork

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
| Prefixo convencional | **Quase nenhum** usa (`docs:` é a exceção, 1 caso). O upstream usa `fix(...)`, mas nós usamos frase imperativa |
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
npx vitest run                     # todos passando; 3 falhas conhecidas
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
#    NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_APP_LOCALE=pt,
#    NEXT_PUBLIC_VAPID_PUBLIC_KEY (Web Push)
#    ⚠ Leia a seção "A armadilha do cache do Docker" ANTES: sem --no-cache
#      o bundle pode sair do build anterior, sem a chave nova.
docker build --no-cache ... -t wacrm-app:latest .

# 2. exportar e transferir
docker save wacrm-app:latest -o wacrm.tar   # ~88 MB comprimido

# 3. na máquina que hospeda os containers (o "homelab")
docker tag wacrm-app:latest wacrm-app:previous   # mantém rollback
docker load -i wacrm.tar
docker compose up -d --force-recreate
```

### A armadilha do cache do Docker (custou três deploys errados)

**Sintoma:** o app em produção diz "o servidor não tem as chaves de push
configuradas" (`no-vapid-key`), mesmo com `NEXT_PUBLIC_VAPID_PUBLIC_KEY` presente no
`env` do container e no `.env.local` do servidor.

**Causa:** os valores `NEXT_PUBLIC_*` são **inlinados no bundle JavaScript em build
time**. O Docker cacheia a camada `RUN npm run build` pelo conteúdo do contexto — e
`ARG`/`ENV` **não invalidam essa camada**. Resultado: `docker build` "termina com
sucesso", produz uma imagem nova, e o bundle dentro dela é o de um build antigo.

O build log mostra a mentira, e é fácil não olhar:

```
#10 CACHED
#11 CACHED
#12 CACHED        ← o npm run build foi reaproveitado
```

**Regra:** qualquer deploy que dependa de um `NEXT_PUBLIC_*` novo ou alterado usa
`docker build --no-cache`. Sem exceção. Custa alguns minutos de build e evita
deploy que "passou" mas não mudou nada.

**Corolário — a verificação tem que ser na imagem que vai subir, não numa de
teste.** Eu validei uma imagem buildada com um `ARG` de teste, confirmei que a chave
estava no bundle, e então construí a imagem real — que veio do cache sem a chave.
O relatório disse "verificado" e o app em produção dizia o contrário.

Verificação que funciona (roda no container, lê o bundle de verdade):

```bash
# o prefixo da chave esperada (16 chars bastam para identificar)
grep -rl "<prefixo-da-chave>" /app/.next/static/chunks/ | head -2
```

E confirme também o inverso: a **chave privada nunca** pode aparecer em
`/.next/static/` — ela é runtime, lida no servidor.

```bash
docker exec wacrm sh -c 'grep -rl "VAPID_PRIVATE_KEY" /app/.next/static/ | wc -l'
# esperado: 0
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

### O IP do homelab muda (e como reconhecer o sintoma)

O homelab pega IP por DHCP e **a rede local inteira pode trocar** — já
aconteceu (a rede `192.168.3.x` virou `192.168.18.x` de uma hora para outra,
sem ninguém mexer em nada). O IP que estava funcionando ontem pode não
existir hoje.

**Sintoma inconfundível:**

- `ssh` para o homelab dá **Connection timed out**, e `ping` perde 100%
- **MAS o app em produção continua respondendo pela web** (a página de login
  abre, o health endpoint responde)

Essa combinação — web viva, SSH morto — significa rede/IP, não aplicação.
NÃO vá depurar o container nem o deploy pipeline: o container está saudável
atrás do túnel Cloudflare, que não depende do IP da LAN.

**O que fazer:**

1. Descubra a rede atual da sua máquina (`Get-NetIPAddress` no Windows —
   o seu IPv4 de Ethernet mostra o prefixo da rede local).
2. Candidate o homelab no prefixo novo (varra a faixa com `ping` ou
   consulte a lista de DHCP do roteador — o hostname do homelab fica no
   `.env.local` do servidor, junto dos demais dados de rede).
3. O SSH usa as **mesmas chaves de sempre** — elas não mudam com o IP.
4. Feito isso, o deploy segue o ciclo normal (`save` → `scp` → `load` →
   `compose up -d --force-recreate`).

**Registro do episódio (2026-11-11):** três deploys ficaram presos um dia
inteiro por causa disso — formatação de texto, enriquecimento das menções e
o push v2. O app continuou no ar o tempo todo; só o caminho de deploy tinha
morrido. Verificar "o app responde pela web?" antes de qualquer outra coisa
teria poupado o dia.

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

**As lacunas `050` e `056` são intencionais — não "conserte".**

A numeração tem buracos e isso confunde à primeira vista:

| Número | Situação |
| --- | --- |
| `050` | Existiu como `050_webhook_status_integrity.sql` e o upstream **renumerou para `054`** (commit `99e272f`) |
| `056` | Nunca existiu |

Preencher essas lacunas com uma migração nova parece organizado e é um erro: o
`apply-migrations.mjs` ordena por nome e registra a versão aplicada em
`schema_migrations`, então um arquivo novo num número que já foi usado em outra
linha do tempo pode ser considerado "já aplicado" e **nunca rodar** — falha
silenciosa, exatamente o pior tipo. Numere sempre a partir do **maior existente + 1**,
nunca num buraco.

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
| Notificação é **dois** ajustes separados, não um switch | Um switch só prometia "notificação" e entregava apenas aviso de aba aberta. Fechou o app, acabou — e o usuário reportou como defeito. Agora há dois cards com promessas distintas: push (app fechado) e navegador (aba aberta) |
| O switch de push só fica ligado se o **servidor** confirmar a inscrição | O navegador pode ter uma inscrição que o banco não conhece. Confiar só no navegador mostrava "Ativo" para um aparelho que nunca receberia nada |
| Push é por **aparelho**, não por usuário | A mesma pessoa atende no desktop e no celular; cada um tem endpoint próprio. Uma coluna no perfil representaria um só |
| Push é enviado por **conta**, não por usuário | O aviso é "chegou mensagem"; qualquer pessoa da equipe pode atender |
| No iPhone só funciona com o app instalado | WebKit entrega Web Push apenas para app na Tela de Início (iOS 16.4+). Não é escolha nossa — o card explica em vez de oferecer um switch que falharia |

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
- **`docker build` e `NEXT_PUBLIC_*`:** `ARG`/`ENV` **não invalidam** a camada
  `RUN npm run build`. Sem `--no-cache` o deploy "passa" e o bundle continua o do
  build anterior. Ver [A armadilha do cache do Docker](#a-armadilha-do-cache-do-docker-custou-três-deploys-errados).
- **`profiles.id` não é o id do usuário.** A PK da linha é `profiles.id`; o vínculo
  com `auth.users` é `profiles.user_id`. Consultar `.eq('id', user.id)` compila, roda
  e **não acha nada** — o erro aparece como "Account not found" ou como uma política
  de RLS que nega tudo em silêncio. Use `getCurrentAccount()`; para SQL, compare com
  `auth.uid()` em `user_id`.
- **Scripts `.mjs` que usam dependência CommonJS** (ex.: `web-push`) precisam de
  `import * as x from 'pkg'` — `import x from 'pkg'` falha com "does not provide an
  export named 'default'" tanto no Turbopack quanto no Node ESM.

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

---

## Relay SMS → WhatsApp (src/adapto/sms-relay)

Existe um relay que replica SMS do celular do operador (códigos 2FA da
Amplimed) para o WhatsApp dele mesmo. O app de encaminhamento no Android
faz POST em `/api/adapto/sms-relay` com o header `x-sms-relay-token`
(env: `SMS_RELAY_TOKEN`, dedidado — NÃO reutilize o segredo do webhook WAHA).

Lições da construção, todas com custo real:

- O WAHA não escuta SMS; a escuta é um app no Android. O servidor é só a ponte.
- `whatsapp_config` não tem coluna com o número; em modo WAHA o número
  mora em `phone_number_id` (o bridge grava `chatIdToPhone(meId)` lá).
- Apps de encaminhamento NÃO expandem placeholder no campo Body do
  webhook (nem MacroDroid nem o wizard em uso). O que salva o servidor é
  ser tolerante: aceitar `{"body": …}`, corpo cru, e procurar o texto
  recursivamente em qualquer campo do JSON — sempre passando pelo MESMO
  filtro de padrão (o prefixo da Amplimed), que é a única porta.
- O app prefixa "From : <número>" no template; o relay faz strip, mas só
  se o resto casar com o padrão.
- Carimbo de hora da mensagem entregue: `America/Sao_Paulo` EXPLICITO
  (o servidor roda em UTC; `toLocaleString` sem timeZone mentia 3h).
- `SMS_RELAY_DEBUG_REJECTS=true` (env, temporário) loga os 80 primeiros
  bytes de corpos rejeitados — ligue para diagnosticar, desligue depois.
- `.dockerignore` exclui testes: `next build` no Docker typecheca tudo o
  que `COPY . .` traz, e um teste com erro de tipo (nunca executado em
  produção) chegou a quebrar um deploy inteiro.