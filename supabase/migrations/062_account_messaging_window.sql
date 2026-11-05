-- ============================================================
-- 062_account_messaging_window.sql
--
-- Interruptor da janela de mensagens de 24 horas, por conta.
--
-- A janela de 24h é uma regra da API oficial da Meta: fora dela, texto
-- livre é recusado. O CRM implementa essa regra no compositor da inbox,
-- desabilitando o campo quando a última mensagem do cliente passou de
-- 24h.
--
-- O WAHA não tem essa janela. Numa instalação que fala por WAHA — o caso
-- deste fork — a regra bloqueia respostas que seriam aceitas. Daí a
-- coluna: a conta pode desligar a regra sem trocar o motor de envio,
-- porque a decisão é de interface, não de transporte.
--
-- Default TRUE de propósito: instalar esta migration não muda o
-- comportamento de ninguém. Quem quiser desligar, desliga em
-- Configurações → Janela de mensagens.
--
-- Idempotente — seguro re-executar.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS enforce_messaging_window BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN accounts.enforce_messaging_window IS
  'Aplica a janela de 24h da Meta no compositor da inbox. Ligue se a conta usa a API oficial; desligue no modo WAHA.';
