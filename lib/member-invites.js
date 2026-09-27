// Inclusão de membros por email como operação persistente: cada email vira
// uma linha em event_member_invites (enfileirada pelo dono, com RLS) e é
// processada aqui com a service role — no próprio request de salvar, dentro
// de um tempo limite, e depois por um worker periódico que sobrevive a
// reinícios do servidor.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_INVITE_ATTEMPTS = 3;
const SETTLED = new Set(['added', 'existing', 'invited']);

export function normalizeEmailList(list) {
  const valid = [], invalid = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    if (EMAIL_RE.test(lower)) valid.push(lower);
    else invalid.push(trimmed);
  }
  return { valid, invalid };
}

// Nunca devolve a mensagem crua do provedor de email — só textos fixos.
export function classifyInviteError(err) {
  const status = err?.status;
  const code = err?.code;
  const msg = String(err?.message || '').toLowerCase();
  if (code === 'email_exists' || code === 'user_already_exists' || /already (been )?registered|already exists/.test(msg)) {
    return { exists: true, transient: false, message: '' };
  }
  if (status === 429 || code === 'over_email_send_rate_limit' || /rate limit/.test(msg)) {
    return { exists: false, transient: true, message: 'Limite de envio de emails atingido.' };
  }
  if (!status || status >= 500 || err?.name === 'AuthRetryableFetchError' || /fetch failed|network|timeout|econn/.test(msg)) {
    return { exists: false, transient: true, message: 'Serviço de email indisponível no momento.' };
  }
  if (code === 'email_address_invalid' || (status === 422 && /email/.test(msg))) {
    return { exists: false, transient: false, message: 'O serviço de email recusou esse endereço.' };
  }
  return { exists: false, transient: false, message: 'Não foi possível enviar o convite para esse email.' };
}

function backoffMs(attempts) {
  return 30000 * 2 ** Math.max(0, attempts - 1);
}

// preexisting: status de cada email ANTES deste salvamento. Quem já estava
// resolvido antes aparece como "já estava na equipe", não como novidade.
export function summarizeInvites(rows, { invalid = [], preexisting = new Map(), skipped = [] } = {}) {
  const summary = { added: [], invited: [], existing: [], pending: [], invalid: [...invalid], failed: [], skipped: [...skipped] };
  for (const row of rows || []) {
    if (SETTLED.has(preexisting.get(row.email))) { summary.existing.push(row.email); continue; }
    if (row.status === 'added') summary.added.push(row.email);
    else if (row.status === 'invited') summary.invited.push(row.email);
    else if (row.status === 'existing') summary.existing.push(row.email);
    else if (row.status === 'failed') summary.failed.push({ email: row.email, error: row.last_error || 'Não foi possível convidar.' });
    else summary.pending.push(row.email);
  }
  return summary;
}

export function hasInviteActivity(summary) {
  if (!summary) return false;
  return ['added', 'invited', 'existing', 'pending', 'invalid', 'failed', 'skipped'].some(k => summary[k]?.length);
}

async function checked(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export function createInviteProcessor({ admin, inviteUser, logError = () => {}, now = () => Date.now() }) {
  async function resolveUserId(email) {
    return (await checked(admin.rpc('find_user_id_by_email', { p_email: email }))) || null;
  }

  async function linkMember(event, userId, successStatus) {
    if (userId === event.owner_id) return { status: 'existing', user_id: userId, last_error: null };
    const { error } = await admin.from('event_members').insert({ event_id: event.id, user_id: userId });
    if (error && error.code !== '23505') throw error;
    return { status: error ? 'existing' : successStatus, user_id: userId, last_error: null };
  }

  function failure(row, classified) {
    if (classified.transient && row.attempts < MAX_INVITE_ATTEMPTS) {
      return {
        status: 'pending',
        last_error: classified.message + ' Nova tentativa automática em instantes.',
        next_attempt_at: new Date(now() + backoffMs(row.attempts)).toISOString()
      };
    }
    return { status: 'failed', last_error: classified.message };
  }

  async function processRow(row, baseUrl) {
    let update;
    try {
      const event = await checked(admin.from('events').select('id, owner_id').eq('id', row.event_id).maybeSingle());
      if (!event) {
        update = { status: 'failed', last_error: 'O evento não existe mais.' };
      } else {
        let userId = await resolveUserId(row.email);
        if (userId) {
          update = await linkMember(event, userId, 'added');
        } else {
          const redirectTo = String(baseUrl || '').replace(/\/$/, '') + '/e/' + encodeURIComponent(row.event_id);
          const { data, error } = await inviteUser(row.email, redirectTo);
          if (error) {
            const classified = classifyInviteError(error);
            if (classified.exists) {
              // corrida: a conta passou a existir entre a busca e o convite
              userId = await resolveUserId(row.email);
              update = userId
                ? await linkMember(event, userId, 'added')
                : failure(row, { transient: true, message: 'Conta em criação.' });
            } else {
              update = failure(row, classified);
            }
          } else {
            update = await linkMember(event, data.user.id, 'invited');
          }
        }
      }
    } catch (err) {
      logError('Convite de membro pendente:', err);
      update = failure(row, { transient: true, message: 'Falha temporária ao processar o convite.' });
    }
    const final = { ...update, claimed_until: null, updated_at: new Date(now()).toISOString() };
    await checked(admin.from('event_member_invites').update(final).eq('event_id', row.event_id).eq('email', row.email));
    return { ...row, ...final };
  }

  // Processa convites vencidos (de um evento ou de todos) até acabar a fila
  // ou o tempo. O que não couber no tempo continua pendente pro worker.
  async function run({ eventId = null, budgetMs = 4000, baseUrl, batch = 5 } = {}) {
    if (!admin) return [];
    const deadline = now() + budgetMs;
    const processed = [];
    while (now() < deadline) {
      const claimed = await checked(admin.rpc('claim_member_invites', { p_limit: batch, p_event_id: eventId }));
      if (!claimed?.length) break;
      for (const row of claimed) processed.push(await processRow(row, baseUrl));
    }
    return processed;
  }

  return { run, processRow };
}
