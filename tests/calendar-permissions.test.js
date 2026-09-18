import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withTransaction, actAsAdmin, actAsUser, actAsAnon, getTwoRealUserIds, closePool } from './db-helper.js';

test('Migração Calendar: autorização por destinatário, fila transacional e revogação', async () => {
  try {
    const [x, y] = await getTwoRealUserIds();
    const migration = (await readFile(new URL('../supabase-calendar-delegation.sql', import.meta.url), 'utf8'))
      .replace(/^begin;$/m, '').replace(/^commit;$/m, '');
    await withTransaction(async db => {
      const installed = (await db.query("select to_regclass('public.calendar_permissions') as name")).rows[0].name;
      if (!installed) await db.query(migration);
      await db.query('delete from calendar_permissions where recipient_id = any($1::uuid[])', [[x,y]]);
      const id = 'test-calendar-permissions';
      await db.query('insert into events(id,owner_id,data) values($1,$2,$3)', [id, x, { event_date: '2026-09-18T10:00:00Z' }]);
      await db.query('insert into event_members(event_id,user_id) values($1,$2)', [id, y]);
      const email = (await db.query('select email from auth.users where id=$1', [x])).rows[0].email;
      await actAsUser(db, y);
      await db.query('select authorize_calendar_organizer($1)', [email]);
      assert.equal((await db.query('select * from calendar_permissions')).rows.length, 1);
      await actAsUser(db, x);
      await db.query('savepoint identity_guard');
      await assert.rejects(db.query('update events set owner_id=$1 where id=$2', [y,id]), /trocar a identidade/);
      await db.query('rollback to savepoint identity_guard');
      assert.equal((await db.query('select * from calendar_permissions')).rows.length, 0);
      assert.equal((await db.query('delete from calendar_permissions where recipient_id=$1', [y])).rowCount, 0);
      await db.query('savepoint denied');
      await assert.rejects(db.query('insert into calendar_permissions(recipient_id,organizer_id) values($1,$2)', [y, x]), /row-level security/);
      await db.query('rollback to savepoint denied');
      await db.query('savepoint queue_denied');
      await assert.rejects(db.query('select * from calendar_sync_queue'), /permission denied/);
      await db.query('rollback to savepoint queue_denied');
      await actAsAnon(db);
      await db.query('savepoint anon_denied');
      await assert.rejects(db.query('select authorize_calendar_organizer($1)', [email]), /permission denied/);
      await db.query('rollback to savepoint anon_denied');
      await actAsAdmin(db);
      assert.equal((await db.query('select calendar_worker_lock($1) as locked', [x])).rows[0].locked, true);
      assert.equal((await db.query('select calendar_worker_lock($1) as locked', [y])).rows[0].locked, false);
      assert.equal((await db.query('select calendar_worker_lock($1,true) as locked', [x])).rows[0].locked, true);
      assert.equal((await db.query('select calendar_worker_lock($1) as locked', [y])).rows[0].locked, true);
      await db.query('delete from calendar_sync_queue where event_id=$1', [id]);
      await actAsUser(db, y);
      await db.query('delete from calendar_permissions where organizer_id=$1', [x]);
      await actAsAdmin(db);
      assert.equal((await db.query('select * from calendar_sync_queue where event_id=$1', [id])).rows.length, 1);
      await db.query('insert into calendar_copies(event_id,user_id,organizer_id,google_event_id) values($1,$2,$3,$4)', [id,y,x,'abc123']);
      await db.query('delete from events where id=$1', [id]);
      assert.equal((await db.query('select * from calendar_copies where event_id=$1', [id])).rows.length, 1);
      assert.equal((await db.query('select * from calendar_sync_queue where event_id=$1', [id])).rows.length, 1);
    });
  } finally { await closePool(); }
});
