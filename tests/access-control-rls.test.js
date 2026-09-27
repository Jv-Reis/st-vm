// Migração de controle de acesso (supabase-access-control.sql) contra o
// Postgres real: aplica a migração dentro da transação se ainda não estiver
// instalada e desfaz tudo no final (ver tests/db-helper.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withTransaction, actAsAdmin, actAsUser, actAsAnon, getTwoRealUserIds, closePool } from './db-helper.js';

async function denied(db, sql, params, pattern) {
  await db.query('savepoint denied');
  try {
    await assert.rejects(db.query(sql, params), pattern);
  } finally {
    await db.query('rollback to savepoint denied');
  }
}

async function asServiceRole(db) {
  await db.query('SET LOCAL role service_role');
}

test('Migração de acesso: modos, links revogáveis, progresso fechado, versão e convites', async () => {
  try {
    const [owner, other] = await getTwoRealUserIds();
    const sql = async file => (await readFile(new URL('../' + file, import.meta.url), 'utf8'))
      .replace(/^begin;\r?$/m, '').replace(/^commit;\r?$/m, '');
    const migration = await sql('supabase-access-control.sql');
    const lockdown = await sql('supabase-access-control-lockdown.sql');
    await withTransaction(async db => {
      // Evento "antigo" criado antes da migração (se ela ainda não rodou) recebe o período de link antigo.
      const installed = (await db.query("select to_regclass('public.event_access') as name")).rows[0].name;
      const legacyId = 'test-access-legacy';
      if (!installed) {
        await db.query("insert into events(id, owner_id, data) values ($1, $2, '{}'::jsonb)", [legacyId, owner]);
        await db.query(migration);
        const legacy = (await db.query('select share_mode, share_token, legacy_link_until > now() + interval \'59 days\' as sixty from event_access where event_id = $1', [legacyId])).rows[0];
        assert.equal(legacy.share_mode, 'collab');
        assert.ok(legacy.share_token.length >= 32);
        assert.equal(legacy.sixty, true, 'eventos existentes: links antigos por 60 dias');
      }
      // Etapa 1 não quebra o servidor anterior, que gravava progresso com a anon key.
      const openProgress = (await db.query("select 1 from pg_policies where tablename = 'event_progress' and policyname = 'public insert progress'")).rows.length;
      if (openProgress) {
        await db.query("insert into events(id, owner_id, data) values ('test-access-compat', $1, '{}'::jsonb)", [owner]);
        await actAsAnon(db);
        await db.query("insert into event_progress(event_id, action, payload) values ('test-access-compat', 'status', '{}'::jsonb)");
        await actAsAdmin(db);
        await db.query(lockdown);
      }
      assert.equal((await db.query("select count(*)::int as n from events e left join event_access a on a.event_id = e.id where a.event_id is null")).rows[0].n, 0,
        'todo evento tem linha de acesso');

      // ---- evento novo nasce "colaborar", com token e sem link antigo ----
      const id = 'test-access-new';
      await db.query("insert into events(id, owner_id, data) values ($1, $2, '{\"event_title\":\"A\"}'::jsonb)", [id, owner]);
      const created = (await db.query('select * from event_access where event_id = $1', [id])).rows[0];
      assert.equal(created.share_mode, 'collab');
      assert.match(created.share_token, /^[A-Za-z0-9_-]{32}$/);
      assert.equal(created.legacy_link_until, null);
      const firstToken = created.share_token;

      // ---- só o dono lê o token; ninguém grava direto ----
      await actAsUser(db, other);
      assert.equal((await db.query('select * from event_access where event_id = $1', [id])).rows.length, 0);
      await denied(db, 'select set_event_share_mode($1, $2)', [id, 'team'], /not event owner/);
      await denied(db, 'select regenerate_event_share_token($1)', [id], /not event owner/);
      await denied(db, 'select disable_event_share_link($1)', [id], /not event owner/);
      await denied(db, "update event_access set share_mode = 'collab' where event_id = $1", [id], /permission denied/);
      await actAsUser(db, owner);
      assert.equal((await db.query('select share_token from event_access where event_id = $1', [id])).rows[0].share_token, firstToken);
      await denied(db, "update event_access set share_token = repeat('x', 40) where event_id = $1", [id], /permission denied/);
      await denied(db, 'select set_event_share_mode($1, $2)', [id, 'publico'], /invalid share mode/);

      // ---- entrar pela equipe: só no modo colaborar ----
      await actAsUser(db, other);
      await denied(db, 'insert into event_members(event_id, user_id) values ($1, $2)', [id, other], /row-level security|permission denied/);
      for (const mode of ['team', 'view']) {
        await actAsUser(db, owner);
        await db.query('select set_event_share_mode($1, $2)', [id, mode]);
        await actAsUser(db, other);
        await denied(db, 'select join_shared_event($1)', [firstToken], /join not allowed/);
      }
      await actAsUser(db, owner);
      await db.query('select set_event_share_mode($1, $2)', [id, 'collab']);
      assert.equal((await db.query('select join_shared_event($1) as id', [firstToken])).rows[0].id, id, 'dono pelo link não vira membro');
      await actAsUser(db, other);
      assert.equal((await db.query('select join_shared_event($1) as id', [firstToken])).rows[0].id, id);
      assert.equal((await db.query('select join_shared_event($1) as id', [firstToken])).rows[0].id, id, 'idempotente');
      await actAsAdmin(db);
      assert.equal((await db.query('select count(*)::int as n from event_members where event_id = $1', [id])).rows[0].n, 1);
      assert.equal((await db.query('select count(*)::int as n from event_members where event_id = $1 and user_id = $2', [id, owner])).rows[0].n, 0);
      await db.query('delete from event_members where event_id = $1', [id]);

      // ---- gerar link novo invalida o anterior na hora ----
      await actAsUser(db, owner);
      const secondToken = (await db.query('select regenerate_event_share_token($1) as t', [id])).rows[0].t;
      assert.notEqual(secondToken, firstToken);
      await actAsUser(db, other);
      await denied(db, 'select join_shared_event($1)', [firstToken], /join not allowed/);
      await actAsAdmin(db);
      assert.equal((await db.query('select count(*)::int as n from event_access where share_token = $1', [firstToken])).rows[0].n, 0);

      // ---- desativar link ----
      await actAsUser(db, owner);
      await db.query('select disable_event_share_link($1)', [id]);
      await actAsUser(db, other);
      await denied(db, 'select join_shared_event($1)', [secondToken], /join not allowed/);
      await actAsUser(db, owner);
      const thirdToken = (await db.query('select regenerate_event_share_token($1) as t', [id])).rows[0].t;
      assert.ok(thirdToken.length >= 32, 'dono pode criar link de novo');

      // ---- endereço antigo: só durante o período e encerrado por mudança explícita ----
      await actAsAdmin(db);
      await db.query("update event_access set legacy_link_until = now() + interval '1 day' where event_id = $1", [id]);
      await actAsUser(db, other);
      assert.equal((await db.query('select join_shared_event(null, $1) as id', [id])).rows[0].id, id);
      await actAsAdmin(db);
      await db.query('delete from event_members where event_id = $1', [id]);
      await actAsUser(db, owner);
      await db.query('select set_event_share_mode($1, $2)', [id, 'collab']);
      assert.notEqual((await db.query('select legacy_link_until from event_access where event_id = $1', [id])).rows[0].legacy_link_until, null,
        'reaplicar o mesmo modo não encerra o link antigo');
      await db.query('select set_event_share_mode($1, $2)', [id, 'view']);
      assert.equal((await db.query('select legacy_link_until from event_access where event_id = $1', [id])).rows[0].legacy_link_until, null);
      await db.query('select set_event_share_mode($1, $2)', [id, 'collab']);
      await actAsUser(db, other);
      await denied(db, 'select join_shared_event(null, $1)', [id], /join not allowed/);
      await actAsAdmin(db);
      await db.query("update event_access set legacy_link_until = now() - interval '1 minute' where event_id = $1", [id]);
      await actAsUser(db, other);
      await denied(db, 'select join_shared_event(null, $1)', [id], /join not allowed/);

      // ---- progresso não passa mais direto pelo PostgREST ----
      for (const act of [db => actAsAnon(db), db => actAsUser(db, owner)]) {
        await act(db);
        await denied(db, "insert into event_progress(event_id, action, payload) values ($1, 'status', '{}'::jsonb)", [id], /permission denied/);
        await denied(db, 'select * from event_progress where event_id = $1', [id], /permission denied/);
      }
      await actAsAnon(db);
      await denied(db, 'select join_shared_event($1)', [thirdToken], /permission denied/);
      await denied(db, 'select * from event_access', [], /permission denied/);
      await asServiceRole(db);
      await db.query("insert into event_progress(event_id, action, payload) values ($1, 'status', '{}'::jsonb)", [id]);
      assert.equal((await db.query('select count(*)::int as n from event_progress where event_id = $1', [id])).rows[0].n, 1);

      // ---- versão: sobe com roteiro/config, não com notas; cliente não escolhe ----
      await actAsAdmin(db);
      const rev = async () => (await db.query('select revision from events where id = $1', [id])).rows[0].revision;
      assert.equal(await rev(), 1);
      await db.query("update events set notes = 'anotação ao vivo' where id = $1", [id]);
      assert.equal(await rev(), 1);
      await db.query('update events set revision = 99 where id = $1', [id]);
      assert.equal(await rev(), 1);
      // edição simultânea: dois saves partindo da versão 1, só o primeiro entra
      const first = await db.query("update events set data = '{\"event_title\":\"B\"}'::jsonb where id = $1 and revision = 1", [id]);
      const second = await db.query("update events set data = '{\"event_title\":\"C\"}'::jsonb where id = $1 and revision = 1", [id]);
      assert.equal(first.rowCount, 1);
      assert.equal(second.rowCount, 0);
      assert.equal(await rev(), 2);
      assert.equal((await db.query('select data->>\'event_title\' as t from events where id = $1', [id])).rows[0].t, 'B');
      await db.query('update events set allow_member_edit = not allow_member_edit where id = $1', [id]);
      assert.equal(await rev(), 3);

      // ---- convites: dono enfileira, reenvio só do que falhou, service role processa ----
      await actAsUser(db, other);
      await denied(db, 'select * from enqueue_member_invites($1, $2)', [id, ['x@example.com']], /not event owner/);
      await denied(db, 'select retry_failed_member_invites($1)', [id], /not event owner/);
      await denied(db, 'select * from claim_member_invites(5)', [], /permission denied/);
      await denied(db, 'select find_user_id_by_email($1)', ['x@example.com'], /permission denied/);
      await actAsUser(db, owner);
      await denied(db, "insert into event_member_invites(event_id, email) values ($1, 'y@example.com')", [id], /permission denied/);
      const queued = (await db.query('select email, status from enqueue_member_invites($1, $2) order by email', [id, [' A@Example.com ', 'a@example.com', 'b@example.com', 'inválido']])).rows;
      assert.deepEqual(queued, [{ email: 'a@example.com', status: 'pending' }, { email: 'b@example.com', status: 'pending' }]);
      assert.equal((await db.query('select count(*)::int as n from event_member_invites where event_id = $1', [id])).rows[0].n, 2);

      await actAsAdmin(db);
      const ownerEmail = (await db.query('select email from auth.users where id = $1', [owner])).rows[0].email;
      await asServiceRole(db);
      const claimed = (await db.query('select email, attempts from claim_member_invites(10, $1) order by email', [id])).rows;
      assert.deepEqual(claimed, [{ email: 'a@example.com', attempts: 1 }, { email: 'b@example.com', attempts: 1 }]);
      assert.equal((await db.query('select count(*)::int as n from claim_member_invites(10, $1)', [id])).rows[0].n, 0, 'reserva impede processar duas vezes');
      // servidor "reinicia" no meio: a reserva expira e o convite volta
      await db.query("update event_member_invites set claimed_until = now() - interval '1 second' where email = 'b@example.com' and event_id = $1", [id]);
      assert.deepEqual((await db.query('select email, attempts from claim_member_invites(10, $1)', [id])).rows, [{ email: 'b@example.com', attempts: 2 }]);
      await db.query("update event_member_invites set status = 'failed', last_error = 'x', claimed_until = null where email = 'a@example.com' and event_id = $1", [id]);
      await db.query("update event_member_invites set status = 'invited', claimed_until = null where email = 'b@example.com' and event_id = $1", [id]);
      assert.equal((await db.query('select find_user_id_by_email($1) as id', [' ' + ownerEmail.toUpperCase() + ' '])).rows[0].id, owner);

      await actAsUser(db, owner);
      await db.query('select * from enqueue_member_invites($1, $2)', [id, ['a@example.com', 'b@example.com']]);
      assert.equal((await db.query("select status from event_member_invites where event_id = $1 and email = 'a@example.com'", [id])).rows[0].status, 'failed',
        'salvar de novo não reenvia falha sozinho');
      assert.equal((await db.query('select retry_failed_member_invites($1) as n', [id])).rows[0].n, 1);
      const after = (await db.query('select email, status, attempts from event_member_invites where event_id = $1 order by email', [id])).rows;
      assert.deepEqual(after, [{ email: 'a@example.com', status: 'pending', attempts: 0 }, { email: 'b@example.com', status: 'invited', attempts: 2 }]);
      await denied(db, "update event_member_invites set status = 'added' where event_id = $1", [id], /permission denied/);
      await actAsUser(db, other);
      assert.equal((await db.query('select * from event_member_invites where event_id = $1', [id])).rows.length, 0, 'só o dono vê os convites');

      // ---- excluir o evento leva acesso e convites junto ----
      await actAsAdmin(db);
      await db.query('delete from events where id = $1', [id]);
      assert.equal((await db.query('select count(*)::int as n from event_access where event_id = $1', [id])).rows[0].n, 0);
      assert.equal((await db.query('select count(*)::int as n from event_member_invites where event_id = $1', [id])).rows[0].n, 0);
    });
  } finally { await closePool(); }
});
