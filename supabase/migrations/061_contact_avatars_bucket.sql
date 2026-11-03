-- ============================================================
-- 061_contact_avatars_bucket.sql
--
-- Bucket para as fotos de contato importadas do WhatsApp.
--
-- Por que não reaproveitar o `avatars` (migration 008):
--   `avatars` recebe o avatar de PERFIL de um usuário e sua política exige
--   que o primeiro segmento do caminho seja `auth.uid()`. Um contato não
--   pertence a um usuário, pertence à CONTA — gravar em
--   `avatars/contacts/<account>/...` é barrado pela RLS
--   ("new row violates row-level security policy"), que foi exatamente o
--   erro que a primeira versão da sincronização produziu.
--
--   Relaxar a política do `avatars` para aceitar `contacts/...` deixaria
--   qualquer autenticado escrever em qualquer caminho prefixado por
--   "contacts", e misturaria dois ciclos de vida diferentes no mesmo bucket.
--
-- Por que um bucket novo em vez de `chat-media`:
--   `chat-media` guarda o anexo de UMA conversa, tem teto de 16 MB e uma
--   lista de MIME voltada a documentos e áudio. Foto de perfil é um dado do
--   CONTATO — um registro por contato, sobrescrito a cada sincronização,
--   e precisa ser apagável em massa sem varrer mídia de conversa. Buckets
--   separados mantêm as duas políticas simples e independentes.
--
-- Escopo: `account-<uuid>/...`, o mesmo padrão de 023/043/055. Todo membro
-- da conta lê; owner/admin/agent escrevem.
--
-- Idempotente — seguro re-executar.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contact-avatars',
  'contact-avatars',
  TRUE,
  2097152, -- 2 MB: uma foto de perfil não passa disso
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Leitura: qualquer membro da conta enxerga as fotos dos contatos da
-- própria conta. Sem isso o inbox mostraria imagem quebrada para o agente.
DROP POLICY IF EXISTS "Members can read contact avatars" ON storage.objects;
CREATE POLICY "Members can read contact avatars"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'contact-avatars'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- Escrita: mesmos papéis que já podem mexer na conexão do WhatsApp
-- (055), porque a sincronização também reescreve nome de contato.
DROP POLICY IF EXISTS "Members can upload contact avatars" ON storage.objects;
CREATE POLICY "Members can upload contact avatars"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'contact-avatars'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- Necessária porque a sincronização usa `upsert: true` (o caminho é estável
-- por contato, então regravar substitui a foto em vez de acumular lixo).
DROP POLICY IF EXISTS "Members can update contact avatars" ON storage.objects;
CREATE POLICY "Members can update contact avatars"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'contact-avatars'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  )
  WITH CHECK (
    bucket_id = 'contact-avatars'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete contact avatars" ON storage.objects;
CREATE POLICY "Members can delete contact avatars"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'contact-avatars'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
