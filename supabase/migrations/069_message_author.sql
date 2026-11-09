-- ============================================================
-- 069 — Autor de mensagem em conversa de grupo.
--
-- PROBLEMA RELATADO: "as mensagens no grupo não trazem a referência de
-- quem está enviando da parte dos outros membros".
--
-- Hoje `messages` só sabe `sender_type` ('customer' | 'agent' | 'bot') e
-- `sender_id` (uuid do perfil, quando é alguém da equipe). Num grupo isso
-- é insuficiente nas duas pontas:
--
--   - membro externo: todos caem em `sender_type='customer'`, sem nome.
--     Várias pessoas diferentes viram "o cliente", e não há como saber
--     quem falou o quê numa thread de 6 participantes.
--   - colega da equipe: `sender_id` resolve pelo `profiles`, então o
--     `authorName` funciona em `message-thread.tsx` — mas só para nós.
--
-- O WAHA JÁ envia o necessário; o dado era simplesmente descartado ao
-- traduzir para o formato Meta. Do payload real:
--
--   participant            = "25229342556178@lid"        (LID do autor)
--   _data.Info.PushName    = "Marketing Amplimed"        (nome de exibição)
--   _data.Info.SenderAlt   = "554991559280@s.whatsapp.net" (telefone real)
--
-- Guardamos os três: o nome para exibir, o LID para deduplicar/identificar
-- sem ambiguidade, e o telefone para o futuro (mencionar, abrir contato).
--
-- Colunas NULL por padrão: conversa individual não tem autor distinto, e
-- as linhas antigas continuam válidas sem backfill.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS author_name TEXT,
  ADD COLUMN IF NOT EXISTS author_wa_id TEXT,
  ADD COLUMN IF NOT EXISTS author_phone TEXT;

COMMENT ON COLUMN messages.author_name IS
  'Nome de exibição de quem enviou, em conversa de grupo (PushName do WhatsApp). NULL em conversa individual e em linhas anteriores à migração 069.';

COMMENT ON COLUMN messages.author_wa_id IS
  'Identificador WhatsApp do autor no grupo (LID ou JID). Estável e único; serve para agrupar mensagens da mesma pessoa mesmo quando o nome muda.';

COMMENT ON COLUMN messages.author_phone IS
  'Telefone do autor quando o WAHA informa o SenderAlt. NULL quando o autor só expõe LID.';

-- Consultas por autor dentro de uma conversa (ex.: "o que o fulano disse")
-- são o uso esperado; um índice parcial evita pesar em conversa individual,
-- onde a coluna é sempre NULL.
CREATE INDEX IF NOT EXISTS idx_messages_group_author
  ON messages (conversation_id, author_wa_id)
  WHERE author_wa_id IS NOT NULL;
