import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', true); // necessário pra req.ip refletir o IP real por trás do proxy do Render
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limit simples em memória (1 instância, sem Redis) — protege a cota
// gratuita do Gemini de abuso, já que /api/parse-roteiro é público (sem login).
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const rateLimitHits = new Map(); // ip -> timestamps[]

function rateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const hits = (rateLimitHits.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Muitas gerações em pouco tempo. Espere alguns minutos e tente de novo.' });
  }
  hits.push(now);
  rateLimitHits.set(ip, hits);
  next();
}

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

function getBearerToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

async function requireAuth(req, res, next) {
  if (!supabase) return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY não configuradas no servidor.' });
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Login necessário.' });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  req.user = data.user;
  req.token = token;
  next();
}

// Cliente por-requisição com o JWT do usuário anexado — necessário pra RLS
// (auth.uid()) reconhecer quem está de fato fazendo a escrita. NÃO usar
// supabase.auth.setSession() no cliente global — misturaria sessões de
// requisições concorrentes de usuários diferentes.
function scopedClient(token) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

app.get('/api/config', (req, res) => {
  res.json({ supabaseUrl: process.env.SUPABASE_URL || '', supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '' });
});

const ICONS = ['pin', 'gear', 'mic', 'play', 'users', 'cup', 'chat', 'flag', 'film', 'box', 'signal', 'heart'];

const CHECKLIST_SCHEMA = {
  type: Type.OBJECT,
  required: ['event_title', 'phases', 'scenes', 'missions'],
  properties: {
    event_title: {
      type: Type.STRING,
      description: 'Nome do evento. Se o texto não disser explicitamente, infira algo curto e razoável.'
    },
    phases: {
      type: Type.ARRAY,
      description: 'Momentos/fases do evento, na ordem em que acontecem (ex: chegada, cerimônia, festa).',
      items: {
        type: Type.OBJECT,
        required: ['key', 'label', 'icon'],
        properties: {
          key: { type: Type.STRING, description: 'Identificador curto em snake_case, sem acento, ex: chegada' },
          label: { type: Type.STRING, description: 'Nome legível da fase, ex: Chegada & Preparação' },
          icon: { type: Type.STRING, enum: ICONS }
        }
      }
    },
    scenes: {
      type: Type.ARRAY,
      description: 'Cada cena/momento individual do roteiro a ser capturado.',
      items: {
        type: Type.OBJECT,
        required: ['phase', 'order', 'title', 'icon', 'formato', 'capture', 'speech', 'can', 'cannot'],
        properties: {
          phase: { type: Type.STRING, description: 'Deve bater exatamente com um "key" de alguma fase em phases.' },
          order: { type: Type.INTEGER, description: 'Ordem da cena dentro do roteiro geral, começando em 1.' },
          title: { type: Type.STRING },
          icon: { type: Type.STRING, enum: ICONS },
          formato: { type: Type.STRING, description: 'Ex: "Story ao vivo" ou "Reels (editado)". Use o que o texto indicar; se não indicar, use "Story ao vivo".' },
          capture: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Lista curta do que captar nessa cena.' },
          speech: { type: Type.STRING, description: 'Fala/legenda sugerida, se houver no texto original. String vazia se não houver.' },
          can: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'O que pode fazer nessa cena. Pode ser vazio.' },
          cannot: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'O que não pode fazer nessa cena. Pode ser vazio.' }
        }
      }
    },
    missions: {
      type: Type.ARRAY,
      description: 'Categorias de momentos soltos para flagrar a qualquer hora, sem ordem fixa (se o texto tiver algo assim). Array vazio se não houver.',
      items: {
        type: Type.OBJECT,
        required: ['key', 'emoji', 'label', 'items'],
        properties: {
          key: { type: Type.STRING },
          emoji: { type: Type.STRING, description: 'Um emoji representando a categoria.' },
          label: { type: Type.STRING },
          items: { type: Type.ARRAY, items: { type: Type.STRING } }
        }
      }
    }
  }
};

const SYSTEM_PROMPT = `Você estrutura roteiros de cobertura de eventos (escritos por storymakers/filmmakers em texto livre, sem formato fixo) em dados prontos para um checklist interativo.

Regras importantes:
- NÃO invente conteúdo criativo (falas, piadas, detalhes) que não esteja implícito no texto original. Sua função é ORGANIZAR, não CRIAR.
- Preserve o tom e as palavras originais o máximo possível ao preencher capture/speech/can/cannot.
- Se um campo não tiver informação no texto (ex: nenhuma fala sugerida), devolva string vazia ou array vazio — não complete com algo genérico.
- Agrupe cenas em fases coerentes na ordem em que o evento acontece. Se o texto não organizar em fases explícitas, infira fases razoáveis a partir da sequência do relato.
- "missions" só existe se o texto mencionar algo como momentos soltos/sem ordem fixa para flagrar a qualquer hora. Se não houver nada assim, devolva um array vazio.

Exemplo do padrão esperado (uma cena, de um roteiro de casamento):
Texto de entrada (trecho): "Antes de tudo: ela chegando, descendo do carro, abrindo a porta, pegando o celular, falando rápido com a equipe. Se soltar uma piada, aproveita. Frase pra usar: 'Bom dia! Hoje são duas cerimônias e duas festas. Desejem sorte.' Pode deixar ela falar solto, sem preparar fala. Não pode interromper pra pedir pose. É pra Stories."

Saída estruturada equivalente (um item de "scenes"):
{
  "phase": "chegada",
  "order": 1,
  "title": "Começa antes de tudo",
  "icon": "pin",
  "formato": "Story ao vivo",
  "capture": ["Ela chegando / descendo do carro", "Abrindo a porta, pegando o celular", "Falando com a equipe, andando rápido"],
  "speech": "\\"Bom dia! Hoje são duas cerimônias e duas festas. Desejem sorte.\\"",
  "can": ["Deixar ela falar naturalmente, sem preparar fala"],
  "cannot": ["Interromper para pedir pose"]
}

Responda SOMENTE com o JSON estruturado, seguindo o schema fornecido.`;

async function generateWithRetry(ai, params, retries = 2, delayMs = 1000) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      const isTransient = err && (err.status === 503 || err.status === 429);
      if (!isTransient || attempt >= retries) throw err;
      await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
}

app.post('/api/parse-roteiro', rateLimit, async (req, res) => {
  const { text } = req.body || {};

  if (!text || typeof text !== 'string' || text.trim().length < 20) {
    return res.status(400).json({ error: 'Cole um roteiro com mais conteúdo antes de gerar.' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY não configurada no servidor. Copie .env.example para .env e adicione sua chave (grátis em aistudio.google.com/apikey).'
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await generateWithRetry(ai, {
      model: 'gemini-flash-latest',
      contents: text,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: CHECKLIST_SCHEMA
      }
    });

    const raw = response.text;
    if (!raw) {
      return res.status(502).json({ error: 'Não consegui estruturar esse texto. Tente reformular ou detalhar mais o roteiro.' });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      console.error('Resposta do Gemini não era JSON válido:', raw);
      return res.status(502).json({ error: 'A IA devolveu um formato inesperado. Tente gerar de novo.' });
    }

    res.json(data);
  } catch (err) {
    console.error('Erro ao chamar a API do Gemini:', err);
    if (err && (err.status === 503 || err.status === 429)) {
      return res.status(503).json({ error: 'O Gemini está sobrecarregado no momento. Tente gerar de novo em alguns segundos.' });
    }
    res.status(500).json({ error: 'Erro ao chamar a IA (Gemini). Verifique a GEMINI_API_KEY e a conexão.' });
  }
});

function validEventPayload(body) {
  const { event_title, phases, scenes, missions, event_date, event_end_date, event_location } = body || {};
  if (!Array.isArray(scenes)) return null;
  return {
    event_title: event_title || 'Evento sem nome',
    phases: phases || [],
    scenes,
    missions: missions || [],
    event_date: event_date || '',
    event_end_date: event_end_date || '',
    event_location: event_location || ''
  };
}

app.post('/api/events', requireAuth, async (req, res) => {
  const payload = validEventPayload(req.body);
  if (!payload) {
    return res.status(400).json({ error: 'Formato de evento inválido.' });
  }

  const id = crypto.randomUUID().split('-')[0];
  const db = scopedClient(req.token);
  const { error } = await db.from('events').insert({ id, data: payload, owner_id: req.user.id });
  if (error) {
    console.error('Erro ao salvar evento:', error);
    return res.status(500).json({ error: 'Não consegui salvar o evento. Tente de novo.' });
  }
  res.json({ id });
});

app.patch('/api/events/:id', requireAuth, async (req, res) => {
  const payload = validEventPayload(req.body);
  if (!payload) {
    return res.status(400).json({ error: 'Formato de evento inválido.' });
  }

  const db = scopedClient(req.token);
  const { data, error } = await db
    .from('events')
    .update({ data: payload })
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Erro ao atualizar evento:', error);
    return res.status(500).json({ error: 'Não consegui salvar as alterações. Tente de novo.' });
  }
  if (!data) {
    return res.status(404).json({ error: 'Evento não encontrado ou você não tem permissão pra editar.' });
  }
  res.json({ id: data.id });
});

app.patch('/api/events/:id/permissions', requireAuth, async (req, res) => {
  const db = scopedClient(req.token);
  const allow = !!req.body.allow_member_edit;
  const { data, error } = await db
    .from('events')
    .update({ allow_member_edit: allow })
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Erro ao atualizar permissão:', error);
    return res.status(500).json({ error: 'Não consegui atualizar a permissão.' });
  }
  if (!data) {
    return res.status(404).json({ error: 'Evento não encontrado ou você não é o dono dele.' });
  }
  res.json({ allow_member_edit: allow });
});

app.get('/api/events', requireAuth, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY não configuradas no servidor.' });
  }

  const db = scopedClient(req.token);
  const [{ data: owned, error: ownedError }, { data: memberships, error: memberError }] = await Promise.all([
    db.from('events').select('id, data, created_at, allow_member_edit').eq('owner_id', req.user.id),
    db.from('event_members').select('event_id').eq('user_id', req.user.id)
  ]);

  if (ownedError || memberError) {
    console.error('Erro ao listar eventos:', ownedError || memberError);
    return res.status(500).json({ error: 'Não consegui carregar seu histórico.' });
  }

  const memberIds = (memberships || []).map((m) => m.event_id).filter((id) => !owned.some((o) => o.id === id));
  let memberEvents = [];
  if (memberIds.length) {
    const { data, error } = await db.from('events').select('id, data, created_at, allow_member_edit').in('id', memberIds);
    if (error) {
      console.error('Erro ao listar eventos salvos:', error);
      return res.status(500).json({ error: 'Não consegui carregar seu histórico.' });
    }
    memberEvents = data || [];
  }

  const events = [
    ...owned.map((row) => ({ ...row, is_owner: true })),
    ...memberEvents.map((row) => ({ ...row, is_owner: false }))
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({
    events: events.map((row) => ({
      id: row.id,
      event_title: row.data?.event_title || 'Evento sem nome',
      scene_count: Array.isArray(row.data?.scenes) ? row.data.scenes.length : 0,
      event_date: row.data?.event_date || '',
      created_at: row.created_at,
      is_owner: row.is_owner,
      is_editor: !row.is_owner && !!row.allow_member_edit
    }))
  });
});

app.get('/api/events/:id/save', requireAuth, async (req, res) => {
  const db = scopedClient(req.token);
  const { data, error } = await db
    .from('event_members')
    .select('event_id')
    .eq('event_id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error) {
    console.error('Erro ao checar evento salvo:', error);
    return res.status(500).json({ error: 'Não consegui checar.' });
  }
  res.json({ saved: !!data });
});

app.post('/api/events/:id/save', requireAuth, async (req, res) => {
  const db = scopedClient(req.token);
  const { error } = await db.from('event_members').insert({ event_id: req.params.id, user_id: req.user.id });
  if (error && error.code !== '23505') {
    console.error('Erro ao salvar evento:', error);
    return res.status(500).json({ error: 'Não consegui salvar esse evento na sua conta.' });
  }
  res.json({ saved: true });
});

app.delete('/api/events/:id/save', requireAuth, async (req, res) => {
  const db = scopedClient(req.token);
  const { error } = await db
    .from('event_members')
    .delete()
    .eq('event_id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) {
    console.error('Erro ao remover evento salvo:', error);
    return res.status(500).json({ error: 'Não consegui remover esse evento da sua conta.' });
  }
  res.json({ saved: false });
});

app.get('/api/events/:id', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY não configuradas no servidor.' });
  }

  const id = req.params.id;
  const [{ data: row, error }, { data: progressRows }] = await Promise.all([
    supabase.from('events').select('data, owner_id, allow_member_edit').eq('id', id).maybeSingle(),
    supabase.from('event_progress').select('action, payload').eq('event_id', id).order('created_at', { ascending: true })
  ]);

  if (error || !row) {
    return res.status(404).json({ error: 'Evento não encontrado. O link pode estar errado ou o evento foi removido.' });
  }
  res.json({ ...row.data, owner_id: row.owner_id, allow_member_edit: !!row.allow_member_edit, progress: foldProgress(progressRows || []) });
});

// ---------- progresso em tempo real (SSE) ----------

const PROGRESS_ACTIONS = new Set(['status', 'record', 'unrecord', 'mission', 'unmission', 'reset']);
const progressSubscribers = new Map(); // eventId -> Set<res>

function foldProgress(rows) {
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

function broadcastProgress(eventId, message) {
  const subs = progressSubscribers.get(eventId);
  if (!subs) return;
  const chunk = `data: ${JSON.stringify(message)}\n\n`;
  for (const res of subs) res.write(chunk);
}

app.post('/api/events/:id/progress', async (req, res) => {
  const id = req.params.id;
  const { action, payload } = req.body || {};

  if (!PROGRESS_ACTIONS.has(action)) {
    return res.status(400).json({ error: 'Ação de progresso inválida.' });
  }
  if (!supabase) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY não configuradas no servidor.' });
  }

  const { error } = await supabase.from('event_progress').insert({ event_id: id, action, payload: payload || {} });
  if (error) {
    console.error('Erro ao salvar progresso:', error);
    return res.status(500).json({ error: 'Não consegui salvar o progresso.' });
  }

  broadcastProgress(id, { action, payload: payload || {} });
  res.json({ ok: true });
});

app.get('/api/events/:id/stream', (req, res) => {
  const id = req.params.id;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write(':ok\n\n');

  if (!progressSubscribers.has(id)) progressSubscribers.set(id, new Set());
  progressSubscribers.get(id).add(res);

  const heartbeat = setInterval(() => res.write(':hb\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    progressSubscribers.get(id)?.delete(res);
  });
});

app.get('/e/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/e/:id/editar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/historico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CAPTURA rodando em http://localhost:${PORT}`);
});
