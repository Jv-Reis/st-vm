// Testes de RLS/autorização — a parte mais crítica do projeto pra cobrir,
// já que o IDOR original (SELECT/UPDATE de `events` liberado pra `anon`) só
// foi achado por um pentest externo, não por revisão interna. Cada teste
// roda dentro de uma transação sempre desfeita (ver tests/db-helper.js), e
// simula o ator (anon / usuário específico / dono) do mesmo jeito que o
// PostgREST faz pra aplicar as policies — não é possível testar RLS de
// verdade com mocks, precisa bater no Postgres real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { withTransaction, actAsAnon, actAsUser, actAsAdmin, getTwoRealUserIds, closePool } from './db-helper.js';

let ownerId, memberId;

before(async () => {
  [ownerId, memberId] = await getTwoRealUserIds();
});

after(async () => {
  await closePool();
});

function testEventId() {
  return 'test-rls-' + crypto.randomUUID().slice(0, 8);
}

// insere o evento (e opcionalmente o membro) como admin, pra fixture não
// depender de nenhuma policy de INSERT — só a parte testada usa o ator real
async function seedEvent(client, { id, allowMemberEdit = false, withMember = false, memberCanEdit } = {}) {
  await actAsAdmin(client);
  await client.query(
    "insert into events (id, data, owner_id, allow_member_edit) values ($1, '{}'::jsonb, $2, $3)",
    [id, ownerId, allowMemberEdit]
  );
  if (withMember) {
    await client.query('insert into event_members (event_id, user_id) values ($1, $2)', [id, memberId]);
    if (typeof memberCanEdit === 'boolean') {
      await client.query('update event_members set can_edit = $1 where event_id = $2 and user_id = $3', [memberCanEdit, id, memberId]);
    }
  }
}

test('anon não lê events', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id });
    await actAsAnon(client);
    const { rows } = await client.query('select id from events where id = $1', [id]);
    assert.equal(rows.length, 0);
  });
});

test('anon não atualiza events', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id });
    await actAsAnon(client);
    const result = await client.query("update events set data = '{\"x\":1}'::jsonb where id = $1", [id]);
    assert.equal(result.rowCount, 0);
  });
});

test('anon não lê event_members', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id, withMember: true });
    await actAsAnon(client);
    const { rows } = await client.query('select * from event_members where event_id = $1', [id]);
    assert.equal(rows.length, 0);
  });
});

test('dono lê o próprio evento', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id });
    await actAsUser(client, ownerId);
    const { rows } = await client.query('select id from events where id = $1', [id]);
    assert.equal(rows.length, 1);
  });
});

test('dono atualiza o próprio evento', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id });
    await actAsUser(client, ownerId);
    const result = await client.query("update events set data = '{\"x\":1}'::jsonb where id = $1", [id]);
    assert.equal(result.rowCount, 1);
  });
});

test('membro com can_edit=true edita o evento', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id, withMember: true, memberCanEdit: true });
    await actAsUser(client, memberId);
    const result = await client.query("update events set data = '{\"x\":1}'::jsonb where id = $1", [id]);
    assert.equal(result.rowCount, 1);
  });
});

test('membro com can_edit=false NÃO edita o evento', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id, withMember: true, memberCanEdit: false });
    await actAsUser(client, memberId);
    const result = await client.query("update events set data = '{\"x\":1}'::jsonb where id = $1", [id]);
    assert.equal(result.rowCount, 0);
  });
});

test('membro com can_edit=true edita as notas (mesma policy de UPDATE vale pra qualquer coluna, notes incluída)', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id, withMember: true, memberCanEdit: true });
    await actAsUser(client, memberId);
    const result = await client.query('update events set notes = $2 where id = $1', [id, 'lembrar do brinde']);
    assert.equal(result.rowCount, 1);
  });
});

test('membro com can_edit=false NÃO edita as notas', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id, withMember: true, memberCanEdit: false });
    await actAsUser(client, memberId);
    const result = await client.query('update events set notes = $2 where id = $1', [id, 'lembrar do brinde']);
    assert.equal(result.rowCount, 0);
  });
});

test('estranho (não dono, não membro) não lê nem edita o evento', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id });
    const stranger = crypto.randomUUID();
    await actAsUser(client, stranger);
    const { rows } = await client.query('select id from events where id = $1', [id]);
    assert.equal(rows.length, 0);
    const result = await client.query("update events set data = '{\"x\":1}'::jsonb where id = $1", [id]);
    assert.equal(result.rowCount, 0);
  });
});

test('dono vê todos os membros do próprio evento', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id, withMember: true });
    await actAsUser(client, ownerId);
    const { rows } = await client.query('select user_id from event_members where event_id = $1', [id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, memberId);
  });
});

test('membro comum só vê a própria linha em event_members', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id, withMember: true });
    await actAsUser(client, memberId);
    const { rows } = await client.query('select user_id from event_members where event_id = $1', [id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, memberId);
  });
});

test('membro comum não consegue mudar a própria permissão', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id, withMember: true, memberCanEdit: false });
    await actAsUser(client, memberId);
    const result = await client.query('update event_members set can_edit = true where event_id = $1 and user_id = $2', [id, memberId]);
    assert.equal(result.rowCount, 0);
  });
});

test('dono consegue promover um membro a editor', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id, withMember: true, memberCanEdit: false });
    await actAsUser(client, ownerId);
    const result = await client.query('update event_members set can_edit = true where event_id = $1 and user_id = $2', [id, memberId]);
    assert.equal(result.rowCount, 1);
  });
});

test('trigger ignora can_edit mandado pelo client e usa o allow_member_edit do evento (false)', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id, allowMemberEdit: false });
    await actAsUser(client, memberId);
    // tenta se auto-inserir já como editor — o trigger deve sobrescrever pra false
    await client.query('insert into event_members (event_id, user_id, can_edit) values ($1, $2, true)', [id, memberId]);
    const { rows } = await client.query('select can_edit from event_members where event_id = $1 and user_id = $2', [id, memberId]);
    assert.equal(rows[0].can_edit, false);
  });
});

test('trigger ignora can_edit mandado pelo client e usa o allow_member_edit do evento (true)', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id, allowMemberEdit: true });
    await actAsUser(client, memberId);
    await client.query('insert into event_members (event_id, user_id, can_edit) values ($1, $2, false)', [id, memberId]);
    const { rows } = await client.query('select can_edit from event_members where event_id = $1 and user_id = $2', [id, memberId]);
    assert.equal(rows[0].can_edit, true);
  });
});

test('event_progress continua público (anon insere e lê) — design intencional, não uma falha', async () => {
  await withTransaction(async (client) => {
    const id = testEventId();
    await seedEvent(client, { id });
    await actAsAnon(client);
    await client.query("insert into event_progress (event_id, action, payload) values ($1, 'status', '{}'::jsonb)", [id]);
    const { rows } = await client.query('select action from event_progress where event_id = $1', [id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'status');
  });
});
