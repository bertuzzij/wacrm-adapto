# Trabalhando neste fork sem vazar segredos

Este repositório é um **downstream** de [`ArnasDon/wacrm`](https://github.com/ArnasDon/wacrm)
(localizado em `upstream`). O `origin` é o seu fork público, onde este código é publicado.

Como o `origin` é público, **qualquer coisa que entre em um commit está imediatamente
visível para o mundo** — inclusive depois de removida, se estiver no histórico.

## Os segredos deste projeto

| Variável | O que é | Onde mora |
| --- | --- | --- |
| `ENCRYPTION_KEY` | chave AES-256-GCM dos tokens do WhatsApp | `.env.local` |
| `WAHA_WEBHOOK_SECRET` | token na URL do webhook | `.env.local` + config da sessão WAHA |
| `WAHA_API_KEY` | autentica no servidor WAHA | `.env.local` |
| `META_APP_SECRET` | assina o webhook interno | `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | bypassa RLS — acesso total ao banco | `.env.local` |
| `SUPABASE_DB_URL` | connection string com a senha do Postgres | `.env.local` |

Nenhum deles é rastreável: todos estão em `.env.local`, que o `.gitignore` bloqueia
via `.env*`. Os arquivos de exemplo (`.env.local.example`, `mcp-server/.env.example`)
existem justamente para documentar as variáveis sem valores reais.

## Três camadas de defesa

### 1. `.gitignore`

Cobre `.env*` (exceto os `.example`), `.secrets/`, `*.pem`, `*.key`, `*.p12`, `*.pfx`,
`credentials.json`, `service-account*.json` e os artefatos gerados localmente
(`.waha-webhook-url.txt`, `.waha-webhooks.backup-*.json`).

Não é suficiente sozinho: não impede que uma **nova** extensão ou um caminho incomum
passe, e não vê nada do que você cola dentro de um arquivo já rastreado.

### 2. Hook `pre-commit` (`scripts/check-secrets.mjs`)

Instalado por `npm run hooks:install` (e automaticamente no `npm install`, via o
script `prepare`). Roda em todo commit e bloqueia quando:

- **o valor literal de qualquer variável do seu `.env.local` aparece** no conteúdo
  staged (é a checagem que mais pega de verdade: você colar uma chave real num
  arquivo de teste ou num doc), ou
- o conteúdo casa com um formato de alta confiança: JWT do Supabase, token de túnel
  Cloudflare, `AKIA…` da AWS, `ghp_…` do GitHub, `sk-…` da OpenAI, bloco
  `BEGIN PRIVATE KEY`, senha dentro de connection string, ou `ALGO_SECRET=…` com valor
  longo.

O hook **não imprime o segredo** — só o nome da variável e o arquivo.

Placeholders legítimos não são bloqueados: `0000…0`, `ci-dummy-*`, `wacrm_live_xxxx`,
`your-…`. Isso é deliberado. Um hook que grita em falso positivo é um hook que as
pessoas desligam.

### 3. Scan manual, sob demanda

```bash
npm run check:secrets          # mesma checagem do hook, a qualquer momento
git stash list                 # confira o que ficou guardado antes de publicar
```

## Se algo vazar

1. **Rotacione primeiro, limpe depois.** Considere o valor comprometido no instante em
   que o push acontece. Rotacionar resolve o risco; reescrever o histórico é cosmético
   e não desfaz a exposição.
   - `ENCRYPTION_KEY`: gere outra (`openssl rand -hex 32`). Os tokens já gravados em
     `whatsapp_config` tornam-se ilegíveis — reconfigure o WhatsApp depois.
   - `WAHA_WEBHOOK_SECRET`: gere outro e re-registre o webhook
     (`node scripts/waha-webhook.mjs --register`).
   - `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_URL`: rotacione no painel do Supabase.
   - `WAHA_API_KEY`: rotacione no servidor WAHA.
2. Remova o valor do arquivo e faça um commit normal.
3. Se o commit já foi para o `origin`, o histórico precisa ser reescrito
   (`git filter-repo`) **e** o fork notificado — mas só faça isso depois de rotacionar.

## Sincronizando com o upstream

```bash
git fetch upstream
git checkout main && git merge upstream/main   # mantém o espelho atualizado
git checkout adapto && git merge main          # traz para o seu branch de trabalho
git push origin adapto
```

`main` fica limpo como espelho do upstream; o trabalho vive em `adapto`. Assim
`git diff upstream/main...adapto` mostra exatamente o que é seu.

Dois ajustes que economizam tempo em sincronizações repetidas:

```bash
git config rerere.enabled true
git config merge.conflictstyle zdiff3
```

## Estrutura das suas mudanças

Mudança estrutural é a que mais conflita com o upstream. Prefira, nesta ordem:

1. **Arquivo novo** — zero conflito. `src/adapto/` para as suas ferramentas.
2. **Ponto de extensão existente** — o upstream já tem um exemplo: `isWahaMode()` em
   `src/lib/whatsapp/meta-api.ts` troca o provedor sem reescrever os chamadores.
3. **Editar arquivo do upstream** — inevitável às vezes, mas mantenha o patch mínimo e
   isolado, para o merge continuar legível.
