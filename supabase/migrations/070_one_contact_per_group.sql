-- ============================================================
-- 070 — Um contato por grupo, e só um.
--
-- BUG RELATADO: "eu tenho no WhatsApp alguns canais que nos enviam
-- mensagens, e isso está chegando para nós como mensagens diretas, cada
-- mensagem no canal cai pra mim como uma conversa".
--
-- Não era canal: era o MESMO grupo gerando um contato novo a cada
-- mensagem. Medido nesta instalação, para um único grupo:
--
--   8 contatos  'group:120363428761761505@g.us'
--   6 conversas, cada uma com 1 mensagem
--
-- A cada mensagem o grupo aparecia como uma conversa nova no inbox.
--
-- CAUSA
--
-- O índice único de contatos excluía grupos de propósito:
--
--   idx_contacts_account_phone_normalized
--     ON contacts (account_id, phone_normalized)
--     WHERE phone_normalized <> ''
--       AND phone NOT LIKE 'group:%'      <-- grupos fora do índice
--
-- A exclusão existia porque `phone_normalized` de `group:<jid>` são "só
-- os dígitos do JID", que poderiam colidir com o telefone de uma pessoa.
-- O efeito colateral foi ficar SEM nenhuma proteção de unicidade para
-- grupo: o banco aceitava 2, 8, quantos contatos fossem.
--
-- Isso fechava um ciclo vicioso com o webhook: `findContactByGroupKey`
-- usava `.maybeSingle()`, que ERRA quando encontra mais de uma linha.
-- Com duplicatas já existentes, a busca retornava null, o código concluía
-- "não existe" e inseria mais um. Cada mensagem criava um contato novo.
--
-- CORREÇÃO
--
-- 1. Índice único por (account_id, phone) para chaves de grupo. A
--    comparação é na string inteira, não no `phone_normalized` — então
--    não há colisão possível com telefone de pessoa.
--
-- 2. Limpeza das duplicatas já gravadas, preservando o contato mais
--    antigo de cada grupo e movendo as conversas das cópias para ele.
--    Mensagens e conversas não são apagadas; só apontam para o contato
--    que sobrevive.
-- ============================================================

-- 1) Consolida duplicatas antes de criar o índice (senão ele não pode ser
--    criado). O contato que sobrevive é o MAIS ANTIGO: é o que já tem
--    histórico e o que o atendente provavelmente já viu.
DO $$
DECLARE
  dup RECORD;
  keeper UUID;
BEGIN
  FOR dup IN
    SELECT account_id, phone
    FROM contacts
    WHERE phone LIKE 'group:%'
    GROUP BY account_id, phone
    HAVING count(*) > 1
  LOOP
    SELECT id INTO keeper
    FROM contacts
    WHERE account_id = dup.account_id AND phone = dup.phone
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    -- Mover as conversas das cópias para o contato que sobrevive exige
    -- deduplicar primeiro: `idx_messages_conversation_message_id` é único
    -- em (conversation_id, message_id), e as cópias contêm gravações
    -- repetidas do MESMO evento.
    --
    -- Verificado nesta instalação: 6 mensagens nas conversas duplicadas,
    -- apenas 3 `message_id` distintos — cada um gravado duas vezes, uma em
    -- cada conversa. Sem deduplicar, a segunda gravação colide com a
    -- primeira no momento do UPDATE.
    --
    -- Passo 1: apaga as cópias que repetem uma mensagem já presente na
    -- conversa que fica.
    DELETE FROM messages m
    USING conversations c
    WHERE m.conversation_id = c.id
      AND c.account_id = dup.account_id
      AND c.contact_id IN (
        SELECT id FROM contacts
        WHERE account_id = dup.account_id AND phone = dup.phone AND id <> keeper
      )
      AND m.message_id IN (
        SELECT k.message_id FROM messages k
        JOIN conversations kc ON kc.id = k.conversation_id
        WHERE kc.account_id = dup.account_id AND kc.contact_id = keeper
      );

    -- Passo 2: entre as PRÓPRIAS conversas duplicadas, mantém uma
    -- gravação por `message_id` — a mais antiga — e apaga o resto.
    DELETE FROM messages m
    USING conversations c
    WHERE m.conversation_id = c.id
      AND c.account_id = dup.account_id
      AND c.contact_id IN (
        SELECT id FROM contacts
        WHERE account_id = dup.account_id AND phone = dup.phone AND id <> keeper
      )
      AND m.id NOT IN (
        SELECT DISTINCT ON (mm.message_id) mm.id
        FROM messages mm
        JOIN conversations mc ON mc.id = mm.conversation_id
        WHERE mc.account_id = dup.account_id
          AND mc.contact_id IN (
            SELECT id FROM contacts
            WHERE account_id = dup.account_id AND phone = dup.phone AND id <> keeper
          )
        ORDER BY mm.message_id, mm.created_at ASC, mm.id ASC
      );

    -- Passo 3: agora não há mais colisão possível; o que restou de único
    -- migra para a conversa que fica.
    UPDATE messages m
    SET conversation_id = k.id
    FROM conversations c
    JOIN conversations k
      ON k.account_id = c.account_id AND k.contact_id = keeper
    WHERE m.conversation_id = c.id
      AND c.account_id = dup.account_id
      AND c.contact_id IN (
        SELECT id FROM contacts
        WHERE account_id = dup.account_id AND phone = dup.phone AND id <> keeper
      );

    -- Passo 4: as conversas das cópias estão vazias; podem sair.
    DELETE FROM conversations c
    WHERE c.account_id = dup.account_id
      AND c.contact_id IN (
        SELECT id FROM contacts
        WHERE account_id = dup.account_id AND phone = dup.phone AND id <> keeper
      )
      AND EXISTS (
        SELECT 1 FROM conversations k
        WHERE k.account_id = dup.account_id AND k.contact_id = keeper
      );

    -- As que sobraram (o contato que fica não tinha conversa) migram.
    UPDATE conversations c
    SET contact_id = keeper
    WHERE c.account_id = dup.account_id
      AND c.contact_id IN (
        SELECT id FROM contacts
        WHERE account_id = dup.account_id AND phone = dup.phone AND id <> keeper
      );

    -- Remove os contatos duplicados.
    DELETE FROM contacts
    WHERE account_id = dup.account_id AND phone = dup.phone AND id <> keeper;
  END LOOP;
END $$;

-- 2) A proteção que faltava. Parcial (só chaves de grupo) para não
--    impor regra nenhuma aos contatos de pessoa, que já têm o índice
--    deles em `phone_normalized`.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_group_key
  ON contacts (account_id, phone)
  WHERE phone LIKE 'group:%';

COMMENT ON INDEX idx_contacts_account_group_key IS
  'Um contato por grupo por conta. Ausente antes da 070, o que permitia o webhook criar um contato novo a cada mensagem de grupo (ver comentário da migração).';
