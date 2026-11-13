-- ============================================================
-- 071 — Redefinição de senha via SQL direto (resgate de acesso).
--
-- POR QUE ESTA MIGRAÇÃO EXISTE
--
-- O email de reset do Supabase chega com link apontando para o Site URL
-- configurado no painel. Enquanto essa configuração estiver errada
-- (localhost), o usuário travado não tem caminho de autoatendimento.
-- A rota /api/admin/users/password redefine a senha com UPDATE direto em
-- auth.users, usando a conexão service-role do servidor.
--
-- COMO A SENHA É ARMAZENADA
--
-- O GoTrue (Supabase Auth) grava bcrypt no encrypted_password. Aqui o
-- hash é gerado PELO BANCO com crypt() do pgcrypto — a senha em claro
-- jamais sai da rota como parâmetro de SQL (ela viaja no body HTTPS da
-- chamada do owner e morre dentro da função), e o formato resultante é
-- byte-compatível com o que o GoTrue espera no login.
--
-- O login posterior pelo Supabase Auth funciona sem diferença — e o
-- usuário continua podendo trocar a própria senha normalmente pela
-- interface (updateUser), que é o fluxo oficial.
--
-- SECURITY DEFINER + search_path travado: a função precisa escrever em
-- auth.users sem depender do search_path da conexão.
--
-- A EXTENSÃO pgcrypto já é usada pelo projeto (gen_random_uuid em
-- migrations anteriores veio de lá / do core do Postgres 13+; crypt()
-- exige a extensão instalada no banco).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.admin_set_user_password(
  p_email TEXT,
  p_password TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  target_user_id UUID;
BEGIN
  -- Piso de comprimento igual ao das outras portas de senha do produto.
  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'password too short';
  END IF;

  SELECT id INTO target_user_id
  FROM auth.users
  WHERE lower(email) = lower(p_email)
  LIMIT 1;

  IF target_user_id IS NULL THEN
    RETURN FALSE; -- usuário não existe; resposta uniforme, sem exception
  END IF;

  -- bcrypt cost 10 = o default do GoTrue. crypt() valida o custo no
  -- hash gravado, então o login continua funcionando como antes.
  UPDATE auth.users
  SET encrypted_password = crypt(p_password, gen_salt('bf', 10)),
      updated_at = now()
  WHERE id = target_user_id;

  -- Desloga o usuário: sessões e refresh tokens pertencentes a ele são
  -- removidos, forçando re-login com a senha nova (política do app).
  DELETE FROM auth.sessions WHERE user_id = target_user_id;
  DELETE FROM auth.refresh_tokens WHERE user_id = target_user_id;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_password(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(TEXT, TEXT) TO postgres;
