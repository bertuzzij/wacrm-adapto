-- ============================================================
-- 065_sign_individual_messages.sql
--
-- Assinatura do atendente também em conversa individual.
--
-- Em grupo a assinatura sempre fez sentido e já é aplicada: o protocolo do
-- WhatsApp não tem campo de autor, então o nome viaja no próprio texto. Em
-- conversa individual não havia como o cliente saber com quem falava,
-- porque todos os atendentes usam o MESMO número.
--
-- Por que uma coluna e não uma preferência por navegador: a assinatura muda
-- o texto que o CLIENTE recebe. Isso é decisão de operação, não de tela —
-- dois atendentes com preferências diferentes mandariam mensagens
-- assinadas e não assinadas para o mesmo cliente no mesmo dia.
--
-- Default FALSE de propósito: assinar em conversa individual muda algo que
-- o cliente final vê, e uma migração não deve alterar o que sai para fora
-- sem alguém escolher.
--
-- Idempotente — seguro re-executar.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS sign_individual_messages BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN accounts.sign_individual_messages IS
  'Prefixa o nome do atendente nas mensagens de conversa individual. Em grupo a assinatura é sempre aplicada.';
