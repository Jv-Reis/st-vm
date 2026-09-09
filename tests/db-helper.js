import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

let pool;
function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL não configurada — veja tests/README.md pra saber como pegar essa connection string no Supabase.');
    }
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

// Roda `fn(client)` dentro de uma transação sempre desfeita no final (rollback
// garantido, mesmo se o teste lançar) — nenhum teste de RLS deixa rastro no
// banco de verdade. `client` é reaproveitado pra simular vários atores em
// sequência dentro do mesmo teste (ex: insere como dono, depois tenta editar
// como membro sem permissão).
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

// A partir daqui, toda query nessa transação roda como se fosse a role `anon`
// do PostgREST — o mesmo papel que o navegador usa sem estar logado.
export async function actAsAnon(client) {
  await client.query('SET LOCAL role anon');
}

// Simula um usuário autenticado específico, do mesmo jeito que o PostgREST
// faz a partir do JWT: role `authenticated` + `request.jwt.claims` com o
// `sub` (auth.uid()) daquele usuário. Chamável várias vezes na mesma
// transação pra trocar de ator no meio do teste.
export async function actAsUser(client, userId) {
  await client.query('SET LOCAL role authenticated');
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: 'authenticated' })]);
}

// Volta a conexão pro papel padrão (o `postgres` da connection string, que
// ignora RLS) — usado só pra montar fixture que nenhuma policy deixaria um
// usuário comum inserir direto (ex: popular dado de teste independente de
// quem é o "dono" simulado).
export async function actAsAdmin(client) {
  await client.query('RESET role');
}

// Dois ids de usuário reais de auth.users, pra usar como "dono" e "membro"
// nos testes — não dá pra criar auth.users sintético fácil (é uma tabela
// gerenciada pelo Supabase Auth, não uma tabela comum), então os testes
// reaproveitam contas que já existem no projeto. Não precisa ser sempre as
// mesmas pessoas — só duas contas reais quaisquer.
export async function getTwoRealUserIds() {
  const { rows } = await getPool().query('select id from auth.users order by created_at asc limit 2');
  if (rows.length < 2) {
    throw new Error('Precisa de pelo menos 2 usuários reais em auth.users pra rodar os testes de RLS.');
  }
  return [rows[0].id, rows[1].id];
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
