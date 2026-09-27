// Decisão de acesso a um evento, sem banco nem rede — o servidor só busca os
// dados (papel da pessoa, modo do evento, token) e pergunta aqui. Separado
// pra testar todas as combinações de modo x papel x link antigo.
//
// Modo            Quem abre                      Quem altera progresso
// team            dono e membros autenticados    dono e membros
// view            + quem tiver o link            só dono e membros
// collab          + quem tiver o link            + quem tiver o link

export const SHARE_MODES = ['team', 'view', 'collab'];

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const EVENT_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export function isValidShareToken(token) {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

export function isValidEventId(id) {
  return typeof id === 'string' && EVENT_ID_RE.test(id);
}

export function normalizeShareMode(mode) {
  return SHARE_MODES.includes(mode) ? mode : null;
}

// role: 'owner' | 'editor' | 'member' | null (quem não é da equipe)
// via:  'token' (link /s/<token>) | 'id' (endereço /e/<id>)
export function decideAccess({ role = null, via, shareMode, tokenMatches = false, legacyUntil = null, now = Date.now() }) {
  if (role) return { canRead: true, canWriteProgress: true, basis: 'team' };
  // Modo desconhecido ou ausente (evento sem linha de acesso) falha fechado.
  const mode = normalizeShareMode(shareMode) || 'team';
  let linkValid = false;
  let basis = null;
  if (via === 'token') {
    linkValid = !!tokenMatches;
    basis = 'link';
  } else if (via === 'id') {
    const until = legacyUntil ? new Date(legacyUntil).getTime() : NaN;
    linkValid = Number.isFinite(until) && until > now;
    basis = 'legacy';
  }
  if (!linkValid || mode === 'team') return { canRead: false, canWriteProgress: false, basis: null };
  return { canRead: true, canWriteProgress: mode === 'collab', basis };
}

// Quem não é da equipe não vê os emails da equipe nem dos convidados.
export function stripPrivateFields(data, isTeam) {
  const copy = { ...(data || {}) };
  if (!isTeam) {
    delete copy.member_emails;
    delete copy.calendar_guests;
  }
  return copy;
}
