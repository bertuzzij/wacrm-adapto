# `src/adapto/`

Código que **não** existe no upstream (`ArnasDon/wacrm`). Tudo aqui é seu.

## A regra

Um fork que sincroniza com o upstream sobrevive de uma coisa: manter o diff pequeno
e concentrado. Cada linha sua dentro de um arquivo do upstream é uma linha que o
próximo `merge` pode transformar em conflito.

Por isso, nesta ordem de preferência:

| Preferência | O que é | Conflito |
| --- | --- | --- |
| **1. Arquivo novo aqui** | funcionalidade inteira num diretório próprio | nenhum |
| **2. Ponto de extensão do upstream** | o upstream já prevê a troca (ex.: `isWahaMode()`) | nenhum |
| **3. Edição mínima no upstream** | um `import` e uma entrada de menu | baixo, mas real |

Se você se pegar reescrevendo um componente do upstream, pare: quase sempre dá
para envolver esse componente em vez de editá-lo.

## Onde o upstream é tocado (e só aqui)

Qualquer edição fora de `src/adapto/` deve estar listada nesta tabela. Se não
estiver, ou o código deveria estar aqui, ou a lista está desatualizada.

| Arquivo | Edição | Por quê |
| --- | --- | --- |
| `src/components/settings/settings-sections.ts` | `'waha'` e `'messaging-window'` na lista + entradas em `SECTION_META` + imports de ícone | registra as abas no rail |
| `src/app/(dashboard)/settings/page.tsx` | dois `import` + duas entradas no mapa `panel` | monta os painéis |
| `src/components/inbox/message-thread.tsx` | o `useMemo` da janela de 24h passou a delegar para `src/adapto/messaging-window/config.ts` | a regra da Meta precisa ser opcional no modo WAHA |
| `src/components/inbox/conversation-list.tsx` | o chip "Janela fechando" some quando a janela está desligada | filtro que nunca enche parece defeito |

Total: **~20 linhas**. Vale conferir com:

```bash
git diff --stat upstream/main...main -- . ':(exclude)src/adapto' ':(exclude)messages'
```

Os dicionários em `messages/*.json` também são arquivos do upstream, mas a edição
é aditiva: cada um ganha um bloco `Settings.waha` novo, sem tocar em chave
existente. Conflito ali só acontece se o upstream reescrever a árvore inteira.

O módulo `messaging-window` segue a mesma ideia: ganha `Settings.messagingWindow`
e a chave `Inbox.sessionTimer.noWindow`.

## Módulos

| Diretório | O que resolve |
| --- | --- |
| `contact-sync/` | nome e foto de contato importados do WhatsApp |
| `inbox/` | sino de não-lidas, status da conversa, resumos |
| `waha-connection/` | painel de conexão, QR, reconexão, métricas |
| `waha-interactive/` | botões/lista nativos com fallback para enquete |
| `messaging-window/` | interruptor da janela de 24h da Meta |

## Servidor e cliente

Regra prática: **segredo nunca chega ao navegador.**

- `WAHA_URL` / `WAHA_API_KEY` são lidos só em código de servidor
  (`src/adapto/**/server/**` e rotas de API). Em componente `'use client'`, nunca.
- O componente de UI fala com as rotas `/api/adapto/...`, e a rota fala com o WAHA.
  O navegador recebe apenas o que a tela precisa mostrar (status, telefone, QR em
  base64), nunca a credencial.
- O QR é a exceção que parece segredo e não é: é um token de pareamento de uso
  único e curto. Ainda assim, ele trafega só pela rota autenticada, nunca embutido
  em HTML renderizado no servidor nem em log.

## Testes

A lógica pura (traduzir status do WAHA em mensagem para o usuário, decidir o que
mostrar) fica separada do I/O justamente para ser testável sem rede:

```bash
npx vitest run src/adapto
```

Arquivos `*.test.ts` ao lado do módulo, no padrão do upstream.
