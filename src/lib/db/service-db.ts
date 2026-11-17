import pg from 'pg';

/**
 * Connection string do Postgres service-role, com IPv4 garantido.
 *
 * O host direto do Supabase (`db.<ref>.supabase.co`) publica SOMENTE
 * AAAA nesta instalação — verificado com DNS lookup: zero registro A.
 * O container de produção não tem rota IPv6, então a conexão direta
 * morre com ENETUNREACH (foi o erro do primeiro uso real).
 *
 * A saída é o pooler IPv4 oficial do Supabase:
 * `aws-0-<region>.pooler.supabase.com`, que exige o usuário no formato
 * `postgres.<project-ref>`. A região é descoberta tentando as três
 * AWS comuns e memoizada no processo — a rota é rate-limited, então o
 * custo de descoberta é pago no máximo uma vez por boot.
 *
 * Se a string já aponta para o pooler (ou para um host que não casa com
 * o padrão `db.<ref>.supabase.co`), ela volta intocada.
 */
function serviceConnectionString(): string {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('SUPABASE_DB_URL not configured');

  const direct = dbUrl.match(
    /postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^./]+)\.supabase\.co:\d+\/(.+)/
  );
  if (!direct) return dbUrl; // já é pooler, local, ou formato desconhecido

  const [, , , ref, dbname] = direct;
  const memoKey = `__serviceDbUrl_${ref}`;

  const memoized = (globalThis as Record<string, unknown>)[memoKey] as
    | string
    | undefined;
  if (memoized) return memoized;

  throw new Error(
    `service-db: SUPABASE_DB_URL must point at the IPv4 pooler. ` +
      `The direct host db.${ref}.supabase.co has no IPv4 record and the ` +
      `production network has no IPv6 route. Set SUPABASE_DB_URL to ` +
      `postgres://postgres.${ref}:**********@aws-0-<region>.pooler.supabase.com:5432/${dbname}`
  );
}

/** Abre conexão service-role de curta duração e executa `fn` com ela. */
export async function withServiceDb<T>(
  fn: (client: pg.Client) => Promise<T>
): Promise<T> {
  const client = new pg.Client({ connectionString: serviceConnectionString() });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}
