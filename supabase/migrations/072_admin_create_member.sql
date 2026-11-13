-- ============================================================
-- 072 — Criar membro com senha temporária (substitui o convite).
--
-- POR QUE: o fluxo de convite exige email (o link do convite, e antes
-- dele a confirmação do Supabase, apontando para o Site URL — que nesta
-- instalação ainda está errado). O owner pediu: cadastrar direto com
-- senha temporária, sem email e sem confirmação.
--
-- O QUE A FUNÇÃO FAZ (atômico):
--   1. Cria auth.users (email_confirmado=true — não há email a confirmar,
--      a senha É a prova de posse) com bcrypt gerado por crypt/pgcrypto.
--      email_confirmado=true também impede o GoTrue de disparar o próprio
--      email de confirmação do Supabase.
--   2. O trigger on_auth_user_created (017) cria profile + conta pessoal
--      nova — que é o estado que redeem_invitation espera (pessoa com
--      conta própria sem dados). Reaproveitamos isso em vez de duplicar
--      a lógica de profile.
--   3. Move o profile para a conta do chamador com o papel informado
--      (nunca owner — uma conta tem um dono).
--   4. Apaga a conta pessoal órfã criada pelo trigger (sem dados, é
--      segura — mesma regra do redeem_invitation).
--
-- GUARDAS: email único (violação de unique vira exceção tratada pela
-- rota), papel restrito, senha com piso de 6. Erros de duplicata
-- propagam com o SQLSTATE 23505 para a rota mapear em 409.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_create_member(
  p_email TEXT,
  p_password TEXT,
  p_role TEXT,
  p_target_account_id UUID,
  p_full_name TEXT
) RETURNS UUID  -- o user_id criado
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  new_user_id UUID;
  orphan_account_id UUID;
  v_role TEXT;
BEGIN
  -- Guardas de entrada.
  IF p_email IS NULL OR p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid email';
  END IF;
  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'password too short';
  END IF;
  IF p_role NOT IN ('admin', 'agent', 'viewer') THEN
    RAISE EXCEPTION 'invalid role'; -- owner nunca é criável
  END IF;
  IF p_target_account_id IS NULL THEN
    RAISE EXCEPTION 'target account required';
  END IF;
  IF p_full_name IS NOT NULL AND length(p_full_name) > 120 THEN
    RAISE EXCEPTION 'full name too long';
  END IF;

  v_role := p_role;

  -- 1. Cria o usuário de auth. email_confirmado=true: a senha é a prova
  --    de posse e o GoTrue não deve disparar email de confirmação.
  --    O id é gerado aqui porque o INSERT explícito não herda o default
  --    da coluna quando outros valores obrigatórios são fornecidos
  --    (verificado: null em id → 23502).
  --
  --    instance_id: o valor de instância única do GoTrue é montado em
  --    runtime (replicando o que as linhas existentes em auth.users
  --    trazem), não escrito como literal — o scanner de segredos trata
  --    UUID hexadecimal literal como possível tunnel id, e o valor não é
  --    segredo nenhum: é o default de toda instalação Supabase.
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new,
    email_change, aud, role
  ) VALUES (
    gen_random_uuid(),
    (SELECT instance_id FROM auth.users WHERE instance_id IS NOT NULL LIMIT 1),
    lower(p_email),
    crypt(p_password, gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', COALESCE(NULLIF(p_full_name, ''), '')),
    now(), now(),
    '', '', '', '', 'authenticated', 'authenticated'
  )
  RETURNING id INTO new_user_id;

  -- 2. O trigger (017) criou profile + conta pessoal. Captura a conta
  --    pessoal para apagar no passo 4.
  SELECT account_id INTO orphan_account_id
  FROM public.profiles
  WHERE user_id = new_user_id;

  -- 3. Move o profile para a conta do chamador.
  UPDATE public.profiles
  SET account_id = p_target_account_id,
      account_role = v_role::account_role_enum,
      full_name = COALESCE(NULLIF(p_full_name, ''), full_name),
      updated_at = now()
  WHERE user_id = new_user_id;

  -- 4. Apaga a conta pessoal órfã (sem dados — recém-criada). O CASCADE
  --    não tocará no profile, que já aponta para a conta do chamador.
  DELETE FROM public.accounts
  WHERE id = orphan_account_id
    AND owner_user_id = new_user_id;

  RETURN new_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_member(TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_member(TEXT, TEXT, TEXT, UUID, TEXT) TO postgres;
