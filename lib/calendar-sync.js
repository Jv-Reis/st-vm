import crypto from 'node:crypto';
import { filterValidEmails } from './pure.js';

export function calendarBody(event, baseUrl) {
  const data = event.data || {};
  const start = new Date(data.event_date || '');
  if (!Number.isFinite(start.getTime())) return null;
  let end = new Date(data.event_end_date || '');
  if (!Number.isFinite(end.getTime()) || end <= start) end = new Date(start.getTime() + 4 * 3600000);
  return {
    summary: data.event_title || 'Evento', location: data.event_location || '',
    description: 'Checklist do CAPTURA: ' + baseUrl.replace(/\/$/, '') + '/e/' + encodeURIComponent(event.id),
    start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }
  };
}

// O ID é persistido antes da chamada HTTP. Repetir após timeout não duplica.
export async function writeGoogleEvent({ token, id, body, remove = false, notify = false, fetchImpl = fetch }) {
  const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  const suffix = notify ? '?sendUpdates=all' : '';
  const request = (url, method, payload) => fetchImpl(url + suffix, {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(20000)
  });
  let response = await request(base + '/' + encodeURIComponent(id), remove ? 'DELETE' : 'PATCH', remove ? null : body);
  if (remove && [404, 410].includes(response.status)) return;
  if (!remove && response.status === 404) {
    response = await request(base, 'POST', { ...body, id });
    if (response.status === 409) response = await request(base + '/' + encodeURIComponent(id), 'PATCH', body);
  }
  if (!response.ok) {
    const error = new Error('Google Calendar: HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }
}

async function checked(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export function createCalendarWorker({ db, getToken, baseUrl, logError, writeEvent = writeGoogleEvent }) {
  let running = false;
  const holder = crypto.randomUUID();
  async function reconcile(eventId, revision) {
    const event = await checked(db.from('events').select('id,owner_id,data').eq('id', eventId).maybeSingle());
    const copies = await checked(db.from('calendar_copies').select('*').eq('event_id', eventId));
    const body = event ? calendarBody(event, baseUrl) : null;
    const desired = new Map();
    const automaticEmails = new Set();
    if (body && event.owner_id) {
      desired.set(event.owner_id, event.owner_id);
      const members = await checked(db.from('event_members').select('user_id').eq('event_id', eventId));
      const grants = await checked(db.from('calendar_permissions').select('recipient_id').eq('organizer_id', event.owner_id));
      const allowed = new Set(grants.map(g => g.recipient_id));
      for (const member of members) {
        if (!allowed.has(member.user_id)) continue;
        desired.set(member.user_id, event.owner_id);
        const { data, error } = await db.auth.admin.getUserById(member.user_id);
        if (error) throw error;
        if (data?.user?.email) automaticEmails.add(data.user.email.toLowerCase());
        const account = await checked(db.from('google_calendar_accounts').select('google_email').eq('user_id', member.user_id).maybeSingle());
        if (account?.google_email) automaticEmails.add(account.google_email.toLowerCase());
      }
    }
    for (const [userId, organizerId] of desired) {
      if (copies.some(c => c.user_id === userId)) continue;
      // Não gera referências para pessoas que nunca conectaram o Google.
      const account = await checked(db.from('google_calendar_accounts').select('user_id').eq('user_id', userId).maybeSingle());
      if (!account) continue;
      await checked(db.from('calendar_copies').upsert({ event_id: eventId, user_id: userId,
        organizer_id: organizerId, google_event_id: crypto.randomBytes(16).toString('hex') },
      { onConflict: 'event_id,user_id', ignoreDuplicates: true }));
    }
    const allCopies = await checked(db.from('calendar_copies').select('*').eq('event_id', eventId));
    const failures = [];
    for (const copy of allCopies) {
      try {
        // Confere novamente antes de cada escrita, inclusive limpeza. Revogação
        // interrompe acesso e mantém o que já estava na agenda.
        if (copy.user_id !== copy.organizer_id) {
          const grant = await checked(db.from('calendar_permissions').select('recipient_id')
            .eq('recipient_id', copy.user_id).eq('organizer_id', copy.organizer_id).maybeSingle());
          if (!grant) continue;
        }
        const token = await getToken(copy.user_id);
        if (!token) {
          const account = await checked(db.from('google_calendar_accounts').select('user_id').eq('user_id', copy.user_id).maybeSingle());
          if (account) throw new Error('Não foi possível renovar o acesso ao Google.');
          continue; // reconexão reenfileira pelo trigger
        }
        if (!await checked(db.rpc('calendar_worker_lock', { p_holder: holder }))) throw new Error('Sincronização transferida para outro servidor.');
        const job = await checked(db.from('calendar_sync_queue').select('revision').eq('event_id', eventId).maybeSingle());
        if (job?.revision !== revision) throw new Error('Evento alterado durante a sincronização.');
        const remove = !desired.has(copy.user_id);
        const owner = copy.user_id === event?.owner_id;
        const payload = body ? { ...body } : null;
        if (owner && payload) payload.attendees = filterValidEmails(event.data.calendar_guests)
          .filter(email => !automaticEmails.has(email.toLowerCase())).map(email => ({ email }));
        try {
          await writeEvent({ token, id: copy.google_event_id, body: payload, remove, notify: copy.user_id === copy.organizer_id });
        } catch (err) {
          // O Google mantém tombstones de eventos apagados manualmente.
          if (!remove && err.status === 410) await checked(db.from('calendar_copies')
            .update({ google_event_id: crypto.randomBytes(16).toString('hex') }).eq('event_id', eventId).eq('user_id', copy.user_id));
          throw err;
        }
        if (remove) await checked(db.from('calendar_copies').delete().eq('event_id', eventId).eq('user_id', copy.user_id));
      } catch (err) { failures.push(err); }
    }
    if (failures.length) throw failures[0];
  }
  return async function run() {
    if (running || !db) return;
    running = true;
    let locked = false;
    try {
      locked = await checked(db.rpc('calendar_worker_lock', { p_holder: holder }));
      if (!locked) return;
      const jobs = await checked(db.from('calendar_sync_queue').select('*').lte('retry_at', new Date().toISOString()).order('retry_at').limit(20));
      for (const job of jobs) {
        try {
          await reconcile(job.event_id, job.revision);
          await checked(db.from('calendar_sync_queue').delete().eq('event_id', job.event_id).eq('revision', job.revision));
        } catch (err) {
          logError('Sincronização do Calendar pendente:', err);
          await checked(db.from('calendar_sync_queue').update({ retry_at: new Date(Date.now() + 60000).toISOString(), last_error: 'Falha na sincronização; nova tentativa automática.' })
            .eq('event_id', job.event_id).eq('revision', job.revision));
        }
      }
    } catch (err) { logError('Fila do Calendar indisponível:', err); }
    finally {
      if (locked) {
        try { await checked(db.rpc('calendar_worker_lock', { p_holder: holder, p_release: true })); }
        catch (err) { logError('Erro ao liberar sincronização:', err); }
      }
      running = false;
    }
  };
}
