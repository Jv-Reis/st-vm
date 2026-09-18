import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarWorker } from '../lib/calendar-sync.js';

function fixture() {
  const tables = {
    events: [{ id: 'e', owner_id: 'x', data: { event_title: 'Cobertura', event_date: '2026-09-18T10:00:00Z', calendar_guests: ['y@example.com', 'guest@example.com'] } }],
    event_members: [{ event_id: 'e', user_id: 'y' }],
    calendar_permissions: [{ recipient_id: 'y', organizer_id: 'x' }],
    google_calendar_accounts: [{ user_id: 'x' }, { user_id: 'y', google_email: 'google-y@example.com' }],
    calendar_copies: [], calendar_sync_queue: [{ event_id: 'e', revision: 'r1', retry_at: '2000-01-01' }]
  };
  const calls = [], errors = [];
  const db = {
    rpc: async () => ({ data: true }),
    auth: { admin: { getUserById: async id => ({ data: { user: { email: id + '@example.com' } } }) } },
    from(table) {
      let filters = [], operation = 'select', payload, single = false;
      const query = {
        select() { return this; }, eq(k,v) { filters.push(row => row[k] === v); return this; },
        lte(k,v) { filters.push(row => row[k] <= v); return this; }, order() { return this; }, limit() { return this; },
        maybeSingle() { single = true; return this; },
        upsert(value) { operation = 'upsert'; payload = value; return this; },
        update(value) { operation = 'update'; payload = value; return this; },
        delete() { operation = 'delete'; return this; },
        then(resolve, reject) {
          try {
            const matches = tables[table].filter(row => filters.every(fn => fn(row)));
            if (operation === 'upsert' && !tables[table].some(r => r.event_id === payload.event_id && r.user_id === payload.user_id)) tables[table].push({ ...payload });
            if (operation === 'update') matches.forEach(row => Object.assign(row, payload));
            if (operation === 'delete') tables[table] = tables[table].filter(row => !matches.includes(row));
            return Promise.resolve({ data: single ? matches[0] || null : matches.map(r => ({ ...r })) }).then(resolve, reject);
          } catch (err) { return Promise.reject(err).then(resolve,reject); }
        }
      };
      return query;
    }
  };
  const options = { db, getToken: async id => tables.google_calendar_accounts.some(a => a.user_id === id) ? id : null,
    baseUrl: 'https://example.com', logError: (...args) => errors.push(args), writeEvent: async args => calls.push(args) };
  const enqueue = () => tables.calendar_sync_queue.push({ event_id: 'e', revision: 'r2', retry_at: '2000-01-01' });
  return { tables, calls, errors, options, enqueue };
}

test('Y recebe evento sem convite mesmo quando X não conectou Google; edição reutiliza ID', async () => {
  const f = fixture(); f.tables.google_calendar_accounts.shift();
  const run = createCalendarWorker(f.options);
  await run();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].token, 'y');
  assert.equal(f.calls[0].body.attendees, undefined);
  const id = f.calls[0].id;
  f.tables.events[0].data.event_title = 'Alterado'; f.enqueue();
  await run();
  assert.equal(f.calls[1].id, id);
  assert.equal(f.calls[1].body.summary, 'Alterado');
  assert.equal(f.errors.length, 0);
});

test('Sem autorização não escreve para Y; convidados automáticos não duplicam', async () => {
  const f = fixture();
  await createCalendarWorker(f.options)();
  assert.deepEqual(f.calls.find(c => c.token === 'x').body.attendees, [{ email: 'guest@example.com' }]);
  f.calls.length = 0; f.tables.calendar_permissions = []; f.enqueue();
  await createCalendarWorker(f.options)();
  assert.ok(f.calls.every(c => c.token !== 'y'));
  assert.ok(f.tables.calendar_copies.some(c => c.user_id === 'y')); // revogação mantém cópia
});

test('Excluir evento limpa cópias e remover membro limpa apenas Y', async () => {
  for (const removeEvent of [true, false]) {
    const f = fixture(); const run = createCalendarWorker(f.options); await run();
    f.calls.length = 0;
    if (removeEvent) f.tables.events = []; else f.tables.event_members = [];
    f.enqueue(); await run();
    assert.equal(f.calls.find(c => c.token === 'y').remove, true);
    assert.equal(f.calls.find(c => c.token === 'x').remove, removeEvent);
    assert.equal(f.tables.calendar_copies.length, removeEvent ? 0 : 1);
  }
});

test('Falha mantém fila e IDs; desconexão não tenta escrever', async () => {
  const f = fixture();
  await createCalendarWorker({ ...f.options, writeEvent: async () => { throw new Error('503'); } })();
  assert.equal(f.tables.calendar_sync_queue.length, 1);
  assert.ok(f.tables.calendar_sync_queue[0].last_error);
  assert.equal(f.tables.calendar_copies.length, 2);
  f.tables.calendar_sync_queue[0].retry_at = '2000-01-01';
  f.tables.google_calendar_accounts = [];
  await createCalendarWorker(f.options)();
  assert.equal(f.calls.length, 0);
});

test('Revisão alterada durante a sincronização impede escrita obsoleta', async () => {
  const f = fixture();
  await createCalendarWorker({ ...f.options, getToken: async id => { f.tables.calendar_sync_queue[0].revision = 'new'; return id; } })();
  assert.equal(f.calls.length, 0);
  assert.equal(f.tables.calendar_sync_queue[0].revision, 'new');
});
