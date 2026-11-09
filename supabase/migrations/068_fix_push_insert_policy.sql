-- Correção pontual da política de INSERT em push_subscriptions.
--
-- A migração 067 foi aplicada usando `profiles.id = auth.uid()` na política,
-- mas `profiles.id` é a PK da linha (um uuid próprio) — o vínculo com
-- auth.users é `profiles.user_id`. A comparação errada não dá erro: ela
-- simplesmente não casa com nenhuma linha e TODA inscrição é negada.
--
-- Reaplicar 067 não resolve, porque o arquivo já está registrado como
-- aplicado. Este arquivo corrige só a política, de forma idempotente.
--
-- Verificado no schema real: profiles(user_id UUID UNIQUE NOT NULL).

DROP POLICY IF EXISTS "push_subscriptions_insert_own" ON push_subscriptions;

CREATE POLICY "push_subscriptions_insert_own"
  ON push_subscriptions
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND account_id = (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );
