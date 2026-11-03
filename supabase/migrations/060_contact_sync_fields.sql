-- ============================================================
-- 060_contact_sync_fields.sql
--
-- Suporte à sincronização de nome e foto de contato a partir do WAHA.
--
-- Duas colunas novas:
--
--   name_source — de onde veio o `contacts.name` atual.
--     'whatsapp' : importado do pushname/name do WhatsApp (pode ser
--                  sobrescrito por uma sincronização futura)
--     'manual'   : editado por uma pessoa; a sincronização NÃO toca
--     NULL       : nunca sincronizado (linhas anteriores a esta migration)
--
--     Sem essa distinção não há como honrar "preserve o nome que eu
--     editei": o CRM guarda apenas a string, e um nome importado é
--     indistinguível de um digitado à mão. O padrão é NULL, e a
--     sincronização trata NULL como "pode preencher".
--
--   avatar_synced_at — quando a foto foi copiada para o nosso Storage.
--     Serve para não rebaixar a mesma imagem a cada execução, e para
--     distinguir "nunca buscamos" de "buscamos e o contato não tem foto".
--
-- Idempotente — seguro re-executar.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS name_source TEXT,
  ADD COLUMN IF NOT EXISTS avatar_synced_at TIMESTAMPTZ;

-- Só os dois valores conhecidos. NULL continua permitido (nunca sincronizado).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_name_source_check'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_name_source_check
      CHECK (name_source IS NULL OR name_source IN ('whatsapp', 'manual'));
  END IF;
END $$;

COMMENT ON COLUMN contacts.name_source IS
  'Origem do name atual: whatsapp (importado, sobrescrevível) | manual (editado por pessoa, preservado) | NULL (nunca sincronizado).';

COMMENT ON COLUMN contacts.avatar_synced_at IS
  'Quando avatar_url foi copiado do WhatsApp para o Storage. NULL = nunca buscado.';

-- A sincronização varre contatos de uma conta e filtra os que têm
-- wa_user_id ou telefone; o índice por conta já existe (idx_contacts_account_id).
-- Este cobre o caso comum "todos os contatos de uma conta, mais antigos primeiro".
CREATE INDEX IF NOT EXISTS idx_contacts_account_avatar_synced
  ON contacts (account_id, avatar_synced_at NULLS FIRST);
