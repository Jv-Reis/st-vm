// Funções sem efeito colateral (sem rede, sem banco, sem relógio de verdade
// além do rate limiter) — separadas do server.js só pra poderem ser testadas
// isoladamente (tests/pure.test.js), sem precisar subir o Express nem
// inicializar os clients de Supabase/Anthropic/Sentry que o server.js carrega
// no import.

// Dobra o log append-only de `event_progress` no estado atual de cada cena
// (status + horários) e das missões marcadas — usado tanto na leitura pública
// de um evento quanto no resync do cliente após reconectar o SSE.
export function foldProgress(rows) {
  const recorded = {};
  const missionsDone = {};
  for (const { action, payload } of rows) {
    if (action === 'status') {
      if (payload.status === 'nao_iniciado') delete recorded[payload.sceneId];
      else recorded[payload.sceneId] = { status: payload.status, andamentoAt: payload.andamentoAt || null, feitoAt: payload.feitoAt || null, postadoAt: payload.postadoAt || null };
    }
    // ações legadas, de progresso gravado antes do status em 3 níveis existir
    else if (action === 'record') recorded[payload.sceneId] = { status: 'feito', andamentoAt: null, feitoAt: payload.time, postadoAt: null };
    else if (action === 'unrecord') delete recorded[payload.sceneId];
    // `itemKey` é o id estável do item de missão; `idx` é o formato antigo
    // (posição no array), de antes dos itens terem id — o log é append-only,
    // então linhas antigas continuam com `idx` pra sempre. Prioriza itemKey
    // quando os dois existem (nunca deveria acontecer, mas por segurança).
    else if (action === 'mission') missionsDone[payload.cat + '-' + (payload.itemKey ?? payload.idx)] = true;
    else if (action === 'unmission') delete missionsDone[payload.cat + '-' + (payload.itemKey ?? payload.idx)];
    else if (action === 'reset') { Object.keys(recorded).forEach(k => delete recorded[k]); Object.keys(missionsDone).forEach(k => delete missionsDone[k]); }
  }
  return { recorded, missionsDone };
}

// Reduz o log append-only de um evento pro conjunto mínimo de linhas que
// dobra (foldProgress) pro EXATO mesmo estado — usado pelo script de
// compactação (scripts/compact-progress-log.js). Guarda `cat`+`itemKey`/`idx`
// separados (nunca concatenados numa string só) porque uma `key` de missão
// gerada por quem usa o app poderia, em teoria, conter um hífen, o que
// tornaria ambíguo separar de volta "categoria" de "item" a partir da string
// combinada que o foldProgress produz pro estado em memória do cliente.
export function computeMinimalProgressRows(rows) {
  const sceneStatus = new Map(); // sceneId -> {status, andamentoAt, feitoAt, postadoAt}
  const missionDone = new Map(); // "cat itemRef" -> payload original (sem concatenar)

  for (const { action, payload } of rows) {
    if (action === 'status') {
      if (payload.status === 'nao_iniciado') sceneStatus.delete(payload.sceneId);
      else sceneStatus.set(payload.sceneId, { status: payload.status, andamentoAt: payload.andamentoAt || null, feitoAt: payload.feitoAt || null, postadoAt: payload.postadoAt || null });
    } else if (action === 'record') {
      sceneStatus.set(payload.sceneId, { status: 'feito', andamentoAt: null, feitoAt: payload.time, postadoAt: null });
    } else if (action === 'unrecord') {
      sceneStatus.delete(payload.sceneId);
    } else if (action === 'mission') {
      const itemRef = payload.itemKey ?? payload.idx;
      missionDone.set(payload.cat + ' ' + itemRef, payload.itemKey !== undefined ? { cat: payload.cat, itemKey: payload.itemKey } : { cat: payload.cat, idx: payload.idx });
    } else if (action === 'unmission') {
      missionDone.delete(payload.cat + ' ' + (payload.itemKey ?? payload.idx));
    } else if (action === 'reset') {
      sceneStatus.clear();
      missionDone.clear();
    }
  }

  const statusRows = [...sceneStatus.entries()].map(([sceneId, entry]) => ({
    action: 'status',
    payload: { sceneId, status: entry.status, andamentoAt: entry.andamentoAt, feitoAt: entry.feitoAt, postadoAt: entry.postadoAt }
  }));
  const missionRows = [...missionDone.values()].map((payload) => ({ action: 'mission', payload }));
  return [...statusRows, ...missionRows];
}

// Calcula quanto tempo passou entre dois horários "HH:MM" do mesmo evento
// (ex: de "Feito" até "Postado") e devolve já formatado ("23min", "1h05") —
// usado só no relatório, pra apontar o gargalo sem o usuário ter que
// subtrair os horários na mão. Assume que `to` é depois de `from` no mesmo
// dia; se der negativo (virou meia-noite no meio da cobertura), soma 24h.
export function formatDelay(from, to) {
  const parse = (s) => {
    const m = typeof s === 'string' && /^(\d{1,2}):(\d{2})$/.exec(s);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const a = parse(from);
  const b = parse(to);
  if (a === null || b === null) return null;
  let diff = b - a;
  if (diff < 0) diff += 24 * 60;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return h > 0 ? h + 'h' + String(m).padStart(2, '0') : m + 'min';
}

// Valida e normaliza o payload de POST/PATCH /api/events — só `scenes`
// precisa ser array (o resto tem default), o resto vira string/array vazios
// se não vier preenchido.
export function validEventPayload(body) {
  const { event_title, phases, scenes, missions, event_date, event_end_date, event_location, drive_folders, calendar_guests, member_emails } = body || {};
  if (!Array.isArray(scenes)) return null;
  return {
    event_title: event_title || 'Evento sem nome',
    phases: phases || [],
    scenes,
    missions: missions || [],
    event_date: event_date || '',
    event_end_date: event_end_date || '',
    event_location: event_location || '',
    drive_folders: Array.isArray(drive_folders) ? drive_folders : [],
    calendar_guests: Array.isArray(calendar_guests) ? calendar_guests : [],
    member_emails: Array.isArray(member_emails) ? member_emails : []
  };
}

// "Final/Fotos finais" -> ["Final", "Fotos finais"] — separa um caminho de
// pasta do Drive em segmentos, ignorando espaços e segmentos vazios (barra
// dupla, barra no início/fim).
export function splitDriveFolderPath(rawPath) {
  return String(rawPath).split('/').map(s => s.trim()).filter(Boolean);
}

// Filtra só o que parece email de verdade antes de mandar pro Google Calendar
// como convidado — uma linha digitada errado na caixa de texto não pode
// derrubar a chamada inteira da API (o Google rejeita o request todo se um
// endereço for inválido).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function filterValidEmails(list) {
  return (Array.isArray(list) ? list : [])
    .map((s) => String(s).trim())
    .filter((s) => EMAIL_RE.test(s));
}

// Rate limit simples em memória (1 instância, sem Redis) — protege rotas de
// abuso. Cada rota usa sua própria instância porque os limites fazem sentido
// em escalas bem diferentes (gerar roteiro custa cota da IA; marcar progresso
// é barato mas pode ser chamado com muito mais frequência num uso legítimo,
// com vários membros da equipe no mesmo evento). `keyFn` deixa escolher se o
// limite é por IP (padrão, rotas sem login) ou por conta (rotas autenticadas
// — precisa rodar depois do `requireAuth` pra `req.user` já existir).
export function makeRateLimiter(windowMs, max, message, keyFn) {
  const hits = new Map(); // chave (ip ou user id) -> timestamps[]
  const getKey = keyFn || ((req) => req.ip || 'unknown');
  return function rateLimit(req, res, next) {
    const key = getKey(req);
    const now = Date.now();
    const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ error: message });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}
