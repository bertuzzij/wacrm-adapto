-- ============================================================
-- 067_push_subscriptions.sql
--
-- Inscrições de Web Push por DISPOSITIVO.
--
-- O problema que isto resolve: até aqui o aviso de mensagem nova era
-- disparado pelo realtime do Supabase dentro da aba aberta. Com o app
-- fechado — que é o caso normal no celular — nada acontecia. Web Push
-- resolve, mas exige guardar no servidor o endpoint e as chaves de cada
-- aparelho.
--
-- Por que uma tabela por dispositivo e não uma coluna no perfil: o mesmo
-- usuário atende no desktop e no celular, e cada um tem um endpoint
-- próprio. Uma coluna só suportaria um aparelho.
--
-- Por que `endpoint` é único global (e não por usuário): o endpoint é
-- emitido pelo serviço de push, não por nós. O mesmo endpoint chegando
-- duas vezes significa a MESMA inscrição de navegador, e o correto é
-- atualizar a linha existente (o navegador troca as chaves quando renova)
-- em vez de acumular duplicatas que enviariam o mesmo aviso várias vezes.
--
-- `user_id` com ON DELETE CASCADE: desligar um usuário da conta não deve
-- deixar endpoints órfãos recebendo aviso de dados de outra conta.
--
-- Idempotente — seguro re-executar.
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- URL do serviço de push (FCM, Mozilla autopush, Apple). Único.
  endpoint TEXT NOT NULL,

  -- Chaves de criptografia do payload (RFC 8291/8292). Sem as duas o
  -- serviço de push recusa a entrega.
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,

  -- User-Agent no momento da inscrição. Serve para o usuário reconhecer o
  -- aparelho na lista ("Chrome no Android") e para limpar inscrições de
  -- navegadores que ele já não usa.
  user_agent TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Atualizado a cada envio bem-sucedido; permite descartar inscrição
  -- morta (navegador reinstalado) depois de um período sem uso.
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint)
);

-- O envio busca todas as inscrições de uma CONTA (o aviso é da conta, não
-- de um usuário: qualquer pessoa da equipe deve ser avisada).
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_account
  ON push_subscriptions (account_id);

-- Limpeza por usuário (sair da conta remove as dele).
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions (user_id);

COMMENT ON TABLE push_subscriptions IS
  'Inscrições de Web Push por dispositivo. Uma linha por navegador/aparelho.';

-- ============================================================
-- RLS
--
-- O cliente só enxerga e gerencia as PRÓPRIAS inscrições (o mesmo
-- aparelho dele). O envio do servidor usa service role e ignora RLS, mas
-- busca por account_id.
--
-- Sem isso, qualquer usuário autenticado poderia listar os endpoints da
-- conta inteira — e um endpoint permite enviar notificação arbitrária
-- para aquele aparelho.
-- ============================================================

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subscriptions_select_own" ON push_subscriptions;
CREATE POLICY "push_subscriptions_select_own"
  ON push_subscriptions
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "push_subscriptions_insert_own" ON push_subscriptions;
CREATE POLICY "push_subscriptions_insert_own"
  ON push_subscriptions
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    -- A conta precisa ser a conta DO PRÓPRIO usuário. Sem isto alguém
    -- poderia se inscrever na conta de terceiros (o `account_id` vem do
    -- cliente) e passar a receber os avisos dela.
    --
    -- A membresia mora em `profiles` neste schema (uma conta ativa por
    -- usuário), não numa tabela de junção. ATENÇÃO: `profiles.id` é a PK da
    -- linha e `profiles.user_id` é o vínculo com `auth.users` — comparar
    -- `id = auth.uid()` compila e retorna vazio, negando toda inscrição.
    AND account_id = (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "push_subscriptions_delete_own" ON push_subscriptions;
CREATE POLICY "push_subscriptions_delete_own"
  ON push_subscriptions
  FOR DELETE
  USING (user_id = auth.uid());

-- UPDATE: o navegador reenvia a mesma inscrição com chaves novas, então o
-- upsert precisa poder atualizar a linha existente — mas só a própria.
DROP POLICY IF EXISTS "push_subscriptions_update_own" ON push_subscriptions;
CREATE POLICY "push_subscriptions_update_own"
  ON push_subscriptions
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
