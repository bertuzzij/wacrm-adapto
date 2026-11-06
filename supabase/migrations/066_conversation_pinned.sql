-- ============================================================
-- 066_conversation_pinned.sql
--
-- Fixar conversa no topo da inbox.
--
-- O caso real: a conversa com o cliente que está resolvendo algo agora, ou
-- a de um grupo onde a equipe inteira acompanha, some da primeira tela assim
-- que três outras conversas recebem mensagem. Fixar é a saída que o usuário
-- já conhece de qualquer app de mensagem.
--
-- `pinned_at` em vez de um booleano: guarda QUANDO foi fixada. Isso permite
-- ordenar várias fixadas da mais recente para a mais antiga, o que um `true`
-- não faz — com várias fixadas e só um booleano, a ordem entre elas seria
-- arbitrária e mudaria sozinha a cada consulta.
--
-- NULL = não fixada. Default NULL, então nada muda para o histórico.
--
-- Índice parcial: a ordenação da inbox só olha esta coluna para as linhas
-- fixadas, que são poucas por conta. Um índice completo seria maior e não
-- seria usado.
--
-- Idempotente — seguro re-executar.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_account_pinned
  ON conversations (account_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

COMMENT ON COLUMN conversations.pinned_at IS
  'Quando a conversa foi fixada no topo da inbox. NULL = não fixada.';
