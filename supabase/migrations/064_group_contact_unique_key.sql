-- ============================================================
-- 064_group_contact_unique_key.sql
--
-- Deixa um contato de grupo e um contato de pessoa coexistirem.
--
-- POR QUE ISSO É NECESSÁRIO (bug medido em produção):
--
-- `idx_contacts_account_phone_normalized` é UNIQUE em
-- `(account_id, phone_normalized)`, e `phone_normalized` é gerado por
-- `regexp_replace(phone, '\D', '', 'g')` — só os dígitos.
--
-- Um contato de grupo guarda `phone = 'group:<jid>'` (ver
-- src/adapto/whatsapp-groups/identity.ts). Aplicando a normalização:
--
--     group:5516997222644-1612366296@g.us
--        -> 55169972226441612366296
--
-- Que é EXATAMENTE o que um contato legado, criado antes do suporte a
-- grupos, já tinha como `phone`. Dois efeitos, os dois ruins:
--
--   1. `findExistingContact` (que compara `phone_normalized`) casava a
--      mensagem do grupo com aquele contato de pessoa, e a conversa ficava
--      `kind = 'direct'`.
--   2. O INSERT do contato de grupo era rejeitado por violação do índice
--      único — o grupo nunca ganhava contato próprio.
--
-- Correção: o índice passa a ignorar linhas cujo `phone` é uma chave de
-- grupo. Assim o `group:` tem espaço próprio ao lado de um contato cujo
-- telefone por acaso seja os dígitos do JID, e a unicidade entre grupos é
-- garantida pelo próprio prefixo (dois JIDs distintos → chaves distintas).
--
-- O predicado usa `phone NOT LIKE 'group:%'`, que é avaliado sobre a
-- coluna de origem, não sobre a gerada — é isso que separa os dois
-- universos.
--
-- Idempotente — seguro re-executar.
-- ============================================================

DROP INDEX IF EXISTS public.idx_contacts_account_phone_normalized;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_phone_normalized
  ON public.contacts (account_id, phone_normalized)
  WHERE phone_normalized <> ''
    AND phone NOT LIKE 'group:%';
