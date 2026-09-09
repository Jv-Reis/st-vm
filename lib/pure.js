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
      else recorded[payload.sceneId] = { status: payload.status, andamentoAt: payload.andamentoAt || null, feitoAt: payload.feitoAt || null };
    }
    // ações legadas, de progresso gravado antes do status em 3 níveis existir
    else if (action === 'record') recorded[payload.sceneId] = { status: 'feito', andamentoAt: null, feitoAt: payload.time };
    else if (action === 'unrecord') delete recorded[payload.sceneId];
    else if (action === 'mission') missionsDone[payload.cat + '-' + payload.idx] = true;
    else if (action === 'unmission') delete missionsDone[payload.cat + '-' + payload.idx];
    else if (action === 'reset') { Object.keys(recorded).forEach(k => delete recorded[k]); Object.keys(missionsDone).forEach(k => delete missionsDone[k]); }
  }
  return { recorded, missionsDone };
}

// Valida e normaliza o payload de POST/PATCH /api/events — só `scenes`
// precisa ser array (o resto tem default), o resto vira string/array vazios
// se não vier preenchido.
export function validEventPayload(body) {
  const { event_title, phases, scenes, missions, event_date, event_end_date, event_location, drive_folders } = body || {};
  if (!Array.isArray(scenes)) return null;
  return {
    event_title: event_title || 'Evento sem nome',
    phases: phases || [],
    scenes,
    missions: missions || [],
    event_date: event_date || '',
    event_end_date: event_end_date || '',
    event_location: event_location || '',
    drive_folders: Array.isArray(drive_folders) ? drive_folders : []
  };
}

// "Final/Fotos finais" -> ["Final", "Fotos finais"] — separa um caminho de
// pasta do Drive em segmentos, ignorando espaços e segmentos vazios (barra
// dupla, barra no início/fim).
export function splitDriveFolderPath(rawPath) {
  return String(rawPath).split('/').map(s => s.trim()).filter(Boolean);
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
