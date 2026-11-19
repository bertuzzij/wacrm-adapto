-- ============================================================
-- 072_deleted_messages.sql
--
-- Mensagens apagadas pelo atendente.
--
-- O fluxo: o atendente apaga a própria mensagem no CRM; o CRM apaga no
-- WhatsApp (para todos os participantes) e marca a linha aqui. O registro
-- permanece — apagar a LINHA perderia o histórico e faria realtime/bolhas
-- tratarem a mensagem como nunca existida — mas o conteúdo sai.
--
-- `deleted_at` é o sinal para a UI: bolha mostra "mensagem apagada" em vez
-- do texto, igual ao WhatsApp.
--
-- `content_type = 'deleted'` entra no CHECK da tabela: sem isso o UPDATE
-- é recusado e o atendente vê erro sem explicação.
--
-- Idempotente — seguro re-executar.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- O CHECK de content_type precisa aceitar o novo valor. Recriado com os
-- valores LIDOS no banco real desta instalação + 'deleted':
--   text, image, document, audio, video, location, template, interactive
-- (sem 'sticker': o CHECK atual não o tem — stickers gravam como image.)
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'messages'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%content_type%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE messages DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE messages
    ADD CONSTRAINT messages_content_type_check
    CHECK (
      content_type = ANY (ARRAY[
        'text'::text, 'image'::text, 'document'::text,
        'audio'::text, 'video'::text, 'location'::text,
        'template'::text, 'interactive'::text, 'deleted'::text
      ])
    );
END $$;

COMMENT ON COLUMN messages.deleted_at IS
  'Quando a mensagem foi apagada pelo atendente. NULL = não apagada. O conteúdo é zerado e o content_type vira ''deleted'' — a UI mostra o rótulo em vez do texto.';
