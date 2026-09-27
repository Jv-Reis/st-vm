import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEmailList, classifyInviteError, summarizeInvites, hasInviteActivity,
  createInviteProcessor, MAX_INVITE_ATTEMPTS
} from '../lib/member-invites.js';

test('normaliza lista de emails: minúsculas, sem duplicados, separa inválidos', () => {
  assert.deepEqual(normalizeEmailList([' Ana@Ex.com ', 'ana@ex.com', '', 'sem-arroba', 'b@c.io', null]), {
    valid: ['ana@ex.com', 'b@c.io'], invalid: ['sem-arroba']
  });
  assert.deepEqual(normalizeEmailList('não é lista'), { valid: [], invalid: [] });
});

test('classifica erros do provedor sem vazar a mensagem original', () => {
  assert.equal(classifyInviteError({ code: 'email_exists', status: 422 }).exists, true);
  assert.equal(classifyInviteError({ message: 'A user with this email address has already been registered', status: 422 }).exists, true);
  const rate = classifyInviteError({ status: 429, message: 'Rate limit exceeded for 1.2.3.4' });
  assert.equal(rate.transient, true);
  assert.doesNotMatch(rate.message, /1\.2\.3\.4/);
  assert.equal(classifyInviteError({ message: 'fetch failed' }).transient, true);
  assert.equal(classifyInviteError({ status: 503 }).transient, true);
  const invalid = classifyInviteError({ status: 422, code: 'email_address_invalid', message: 'Email address "x@y.z" is invalid' });
  assert.deepEqual(invalid, { exists: false, transient: false, message: 'O serviço de email recusou esse endereço.' });
  assert.equal(classifyInviteError({ status: 400, message: 'segredo interno' }).message, 'Não foi possível enviar o convite para esse email.');
});

test('resumo separa adicionados, convidados, existentes, pendentes e falhas', () => {
  const rows = [
    { email: 'a@x.co', status: 'added' }, { email: 'b@x.co', status: 'invited' },
    { email: 'c@x.co', status: 'existing' }, { email: 'd@x.co', status: 'pending' },
    { email: 'e@x.co', status: 'failed', last_error: 'Limite de envio de emails atingido.' },
    { email: 'f@x.co', status: 'added' }
  ];
  const s = summarizeInvites(rows, { invalid: ['ruim'], preexisting: new Map([['f@x.co', 'invited']]), skipped: ['g@x.co'] });
  assert.deepEqual(s.added, ['a@x.co']);
  assert.deepEqual(s.invited, ['b@x.co']);
  assert.deepEqual(s.existing, ['c@x.co', 'f@x.co'], 'quem já estava resolvido antes aparece como existente');
  assert.deepEqual(s.pending, ['d@x.co']);
  assert.deepEqual(s.failed, [{ email: 'e@x.co', error: 'Limite de envio de emails atingido.' }]);
  assert.deepEqual(s.invalid, ['ruim']);
  assert.deepEqual(s.skipped, ['g@x.co']);
  assert.equal(hasInviteActivity(s), true);
  assert.equal(hasInviteActivity(summarizeInvites([])), false);
  assert.equal(hasInviteActivity(null), false);
});

// ---------- processador com banco falso ----------
// Imita as partes do supabase-js usadas pelo processador e as regras da RPC
// claim_member_invites (pendente vencido ou "processing" com trava expirada).

function fakeDb({ events = [{ id: 'ev1', owner_id: 'owner' }], users = {}, invites = [], members = [] } = {}) {
  const db = { events, users: { ...users }, invites: invites.map(r => ({ attempts: 0, next_attempt_at: null, claimed_until: null, ...r })), members: [...members] };
  let clock = Date.parse('2026-09-25T12:00:00Z');
  const now = () => clock;
  const advance = ms => { clock += ms; };

  function query(table) {
    const filters = [];
    let op = 'select', payload = null;
    const api = {
      select() { return api; },
      eq(col, val) { filters.push([col, val]); return api; },
      insert(row) { op = 'insert'; payload = row; return api; },
      update(row) { op = 'update'; payload = row; return api; },
      maybeSingle() { op = op === 'select' ? 'single' : op; return api; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); }
    };
    const match = row => filters.every(([c, v]) => row[c] === v);
    function run() {
      const rows = table === 'events' ? db.events : table === 'event_members' ? db.members : db.invites;
      if (op === 'insert') {
        if (rows.some(r => r.event_id === payload.event_id && r.user_id === payload.user_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        rows.push({ ...payload });
        return { data: null, error: null };
      }
      if (op === 'update') {
        rows.filter(match).forEach(r => Object.assign(r, payload));
        return { data: null, error: null };
      }
      const found = rows.filter(match);
      return { data: op === 'single' ? (found[0] || null) : found, error: null };
    }
    return api;
  }

  const admin = {
    from: query,
    async rpc(name, args) {
      if (name === 'find_user_id_by_email') return { data: db.users[args.p_email] || null, error: null };
      if (name === 'claim_member_invites') {
        const due = db.invites.filter(r =>
          (!args.p_event_id || r.event_id === args.p_event_id) &&
          ((r.status === 'pending' && (!r.next_attempt_at || Date.parse(r.next_attempt_at) <= clock)) ||
           (r.status === 'processing' && r.claimed_until && Date.parse(r.claimed_until) < clock))
        ).slice(0, args.p_limit);
        due.forEach(r => { r.status = 'processing'; r.attempts += 1; r.claimed_until = new Date(clock + 120000).toISOString(); });
        return { data: due.map(r => ({ ...r })), error: null };
      }
      return { data: null, error: { code: 'PGRST202', message: 'unknown rpc ' + name } };
    }
  };
  return { db, admin, now, advance };
}

function inviteOk(db) {
  const sent = [];
  const fn = async (email, redirectTo) => {
    sent.push({ email, redirectTo });
    const id = 'new-' + email;
    db.users[email] = id;
    return { data: { user: { id } }, error: null };
  };
  fn.sent = sent;
  return fn;
}

test('processa conta existente, convite novo, dono e membro repetido', async () => {
  const { db, admin, now } = fakeDb({
    users: { 'conta@x.co': 'u1', 'dono@x.co': 'owner', 'ja@x.co': 'u2' },
    members: [{ event_id: 'ev1', user_id: 'u2' }],
    invites: ['conta@x.co', 'novo@x.co', 'dono@x.co', 'ja@x.co'].map(email => ({ event_id: 'ev1', email, status: 'pending' }))
  });
  const inviteUser = inviteOk(db);
  const processor = createInviteProcessor({ admin, inviteUser, now });
  const out = await processor.run({ eventId: 'ev1', baseUrl: 'https://captura.example/' });
  const status = Object.fromEntries(out.map(r => [r.email, r.status]));
  assert.deepEqual(status, { 'conta@x.co': 'added', 'novo@x.co': 'invited', 'dono@x.co': 'existing', 'ja@x.co': 'existing' });
  assert.deepEqual(inviteUser.sent, [{ email: 'novo@x.co', redirectTo: 'https://captura.example/e/ev1' }]);
  assert.ok(db.members.some(m => m.user_id === 'u1'));
  assert.ok(db.members.some(m => m.user_id === 'new-novo@x.co'));
  assert.equal(db.members.some(m => m.user_id === 'owner'), false, 'dono não vira membro');
  assert.ok(db.invites.every(r => r.claimed_until === null));
});

test('falha temporária volta pra fila com espera e vira falha após o limite', async () => {
  const { db, admin, now, advance } = fakeDb({ invites: [{ event_id: 'ev1', email: 'lento@x.co', status: 'pending' }] });
  let calls = 0;
  const inviteUser = async () => { calls++; return { data: null, error: { status: 429, message: 'rate limit' } }; };
  const processor = createInviteProcessor({ admin, inviteUser, now });

  await processor.run({ eventId: 'ev1' });
  const row = db.invites[0];
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 1);
  assert.match(row.last_error, /Limite de envio/);
  assert.ok(Date.parse(row.next_attempt_at) > now());

  await processor.run({ eventId: 'ev1' });
  assert.equal(calls, 1, 'não tenta de novo antes da espera');

  for (let i = 1; i < MAX_INVITE_ATTEMPTS; i++) {
    advance(10 * 60 * 1000);
    await processor.run({ eventId: 'ev1' });
  }
  assert.equal(calls, MAX_INVITE_ATTEMPTS);
  assert.equal(row.status, 'failed');
  assert.equal(row.last_error, 'Limite de envio de emails atingido.');
});

test('erro definitivo falha na hora; reenviar processa só o que falhou', async () => {
  const { db, admin, now } = fakeDb({
    invites: [
      { event_id: 'ev1', email: 'ruim@x.co', status: 'pending' },
      { event_id: 'ev1', email: 'ok@x.co', status: 'invited', attempts: 1 }
    ]
  });
  let reject = true;
  const sent = [];
  const inviteUser = async email => {
    sent.push(email);
    if (reject) return { data: null, error: { status: 422, code: 'email_address_invalid', message: 'invalid email' } };
    return { data: { user: { id: 'u-' + email } }, error: null };
  };
  const processor = createInviteProcessor({ admin, inviteUser, now });
  await processor.run({ eventId: 'ev1' });
  assert.equal(db.invites[0].status, 'failed');
  assert.equal(db.invites[0].attempts, 1);

  // retry_failed_member_invites (RPC) só reabre as falhas
  db.invites.filter(r => r.status === 'failed').forEach(r => Object.assign(r, { status: 'pending', attempts: 0, last_error: null, next_attempt_at: null }));
  reject = false;
  await processor.run({ eventId: 'ev1' });
  assert.deepEqual(sent, ['ruim@x.co', 'ruim@x.co'], 'o convite já enviado não é reenviado');
  assert.equal(db.invites[0].status, 'invited');
  assert.equal(db.invites[1].status, 'invited');
});

test('corrida: conta criada entre a busca e o convite vira membro adicionado', async () => {
  const { db, admin, now } = fakeDb({ invites: [{ event_id: 'ev1', email: 'corrida@x.co', status: 'pending' }] });
  const inviteUser = async email => {
    db.users[email] = 'u-corrida';
    return { data: null, error: { status: 422, code: 'email_exists', message: 'already registered' } };
  };
  const out = await createInviteProcessor({ admin, inviteUser, now }).run({ eventId: 'ev1' });
  assert.equal(out[0].status, 'added');
  assert.ok(db.members.some(m => m.user_id === 'u-corrida'));
});

test('reinício do servidor: convite preso em "processing" é retomado quando a trava expira', async () => {
  const { db, admin, now, advance } = fakeDb({
    invites: [{ event_id: 'ev1', email: 'preso@x.co', status: 'processing', attempts: 1, claimed_until: new Date(Date.parse('2026-09-25T12:01:00Z')).toISOString() }]
  });
  const inviteUser = inviteOk(db);
  // processo novo (o antigo morreu no meio): enquanto a trava vale, ninguém pega
  const processor = createInviteProcessor({ admin, inviteUser, now });
  assert.deepEqual(await processor.run({}), []);
  advance(2 * 60 * 1000);
  const out = await processor.run({});
  assert.equal(out.length, 1);
  assert.equal(db.invites[0].status, 'invited');
  assert.equal(db.invites[0].attempts, 2);
});

test('evento apagado e erro inesperado de banco', async () => {
  const { db, admin, now } = fakeDb({ events: [], invites: [{ event_id: 'sumiu', email: 'a@x.co', status: 'pending' }] });
  await createInviteProcessor({ admin, inviteUser: inviteOk(db), now }).run({});
  assert.equal(db.invites[0].status, 'failed');
  assert.equal(db.invites[0].last_error, 'O evento não existe mais.');

  const second = fakeDb({ invites: [{ event_id: 'ev1', email: 'b@x.co', status: 'pending' }] });
  const brokenAdmin = { ...second.admin, rpc: async (name, args) => name === 'find_user_id_by_email'
    ? { data: null, error: { message: 'connection reset' } } : second.admin.rpc(name, args) };
  const logged = [];
  await createInviteProcessor({ admin: brokenAdmin, inviteUser: inviteOk(second.db), now: second.now, logError: (...a) => logged.push(a) }).run({});
  assert.equal(second.db.invites[0].status, 'pending');
  assert.match(second.db.invites[0].last_error, /Falha temporária/);
  assert.equal(logged.length, 1);
});

test('respeita o tempo limite do request e deixa o resto pro worker', async () => {
  const invites = Array.from({ length: 12 }, (_, i) => ({ event_id: 'ev1', email: `p${i}@x.co`, status: 'pending' }));
  const { db, admin, now, advance } = fakeDb({ invites });
  const inviteUser = async (email, r) => { advance(1500); return inviteOk(db)(email, r); };
  const out = await createInviteProcessor({ admin, inviteUser, now }).run({ eventId: 'ev1', budgetMs: 4000, batch: 2 });
  assert.ok(out.length < 12 && out.length >= 2, `processou ${out.length}`);
  assert.ok(db.invites.some(r => r.status === 'pending'));
});
