-- ============================================================
-- 063_conversation_kind.sql
--
-- Marca uma conversa como individual ('direct') ou de grupo ('group').
--
-- O CRM nasceu modelado só para conversa individual: o tradutor do
-- webhook WAHA descartava qualquer chat `@g.us` de propósito
-- (`isIgnoredChat`). Para grupos aparecerem na inbox isso muda, e a
-- inbox precisa de um jeito barato de separar os dois.
--
-- Por que a coluna fica em `conversations`, e não se deduz de
-- `contacts.wa_user_id` ou do prefixo `group:` em `contacts.phone`:
-- o filtro da inbox consulta conversas. Deduzir o tipo exigiria um
-- JOIN com `contacts` em toda listagem — inclusive as paginadas e as
-- que alimentam contadores — e, na prática, seria uma coluna
-- desnormalizada mantida por JOIN. Aqui é um WHERE direto sobre um
-- índice.
--
-- Default 'direct' de propósito: toda conversa existente é individual,
-- então a migração não altera dado nenhum e não reescreve a tabela
-- (ADD COLUMN com default constante é metadata-only no PG 11+).
--
-- Idempotente — seguro re-executar.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'direct';

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_kind_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_kind_check
  CHECK (kind IN ('direct', 'group'));

-- O filtro "Grupos" da inbox é um WHERE em (account_id, kind).
CREATE INDEX IF NOT EXISTS idx_conversations_account_kind
  ON conversations (account_id, kind);

COMMENT ON COLUMN conversations.kind IS
  'direct = conversa individual; group = conversa de grupo do WhatsApp.';
