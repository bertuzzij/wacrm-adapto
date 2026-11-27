-- ============================================================
-- 076_filter_contacts_by_name_kind.sql
--
-- Filtro server-side de contatos por tipo de nome (com nome real vs
-- apenas numero de telefone), combinavel com busca e filtro por tags.
--
-- Por que uma RPC propria em vez de filtrar no cliente:
--   A tela de Contatos pagina no servidor (25 por pagina). Filtrar
--   no cliente quebraria o contador total e deixaria paginas quase
--   vazias. E nao editamos a 025 (`filter_contacts_by_tags`) para
--   manter o diff minimo em relacao ao upstream.
--
-- Regra de "nome e o numero":
--   name IS NULL OR btrim(name) = ''
--   OR (btrim(name) ~ '^[+0-9 ()-]+$' AND btrim(name) ~ '[0-9]')
--   Cobre tanto o formato cru gravado pelo webhook (`5516992535543`)
--   quanto numeros formatados (`+55 (16) 99253-5543`), sem pegar
--   nomes reais que contenham digitos (ex.: "Clinica 24h").
--
-- Seguranca:
--   SECURITY INVOKER — roda com as permissoes do chamador e respeita
--   integralmente a RLS de `contacts` e `contact_tags`.
--
-- Idempotente — seguro re-executar.
-- ============================================================

CREATE OR REPLACE FUNCTION public.filter_contacts_adapto(
  p_name_kind TEXT DEFAULT 'all',
  p_tag_ids UUID[] DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT c.id, c.created_at
    FROM contacts c
    WHERE (
      p_tag_ids IS NULL
      OR cardinality(p_tag_ids) = 0
      OR EXISTS (
        SELECT 1
        FROM contact_tags ct
        WHERE ct.contact_id = c.id
          AND ct.tag_id = ANY(p_tag_ids)
      )
    )
    AND (
      p_search IS NULL
      OR c.name ILIKE '%' || p_search || '%'
      OR c.phone ILIKE '%' || p_search || '%'
      OR c.email ILIKE '%' || p_search || '%'
    )
    AND (
      CASE p_name_kind
        WHEN 'phone_only' THEN (
          c.name IS NULL
          OR btrim(c.name) = ''
          OR (btrim(c.name) ~ '^[+0-9 ()-]+$' AND btrim(c.name) ~ '[0-9]')
        )
        WHEN 'named' THEN NOT (
          c.name IS NULL
          OR btrim(c.name) = ''
          OR (btrim(c.name) ~ '^[+0-9 ()-]+$' AND btrim(c.name) ~ '[0-9]')
        )
        ELSE TRUE
      END
    )
  ),
  page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;

ALTER FUNCTION public.filter_contacts_adapto(TEXT, UUID[], TEXT, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_adapto(TEXT, UUID[], TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_adapto(TEXT, UUID[], TEXT, INT, INT) TO authenticated;
