import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0 // só rastreamento de erro, sem tracing de performance
  });
}

// console.error continua indo pro log do Render (útil olhando ao vivo); isso
// só soma o envio pro Sentry (agrupamento, alerta por e-mail, stack trace) —
// sem SENTRY_DSN configurada, vira só o console.error de sempre.
function logError(message, err) {
  console.error(message, err);
  if (process.env.SENTRY_DSN) {
    // erros do Supabase (e outros libs) não são instância de Error — são um
    // objeto com .message/.code/.details. String(err) neles vira "[object
    // Object]", perdendo a informação; por isso o fallback usa err.message
    // quando existe, e guarda o objeto original inteiro como contexto extra.
    const wrapped = err instanceof Error ? err : new Error((err && err.message) || String(err));
    Sentry.captureException(wrapped, { extra: { message, original: err } });
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Confia só no primeiro salto (o proxy do Render em si) — "true" confiaria
// na cadeia inteira de X-Forwarded-For, deixando o próprio cliente forjar o
// IP que os limitadores de requisição acima enxergam.
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limit simples em memória (1 instância, sem Redis) — protege rotas de
// abuso. Cada rota usa sua própria instância porque os limites fazem sentido
// em escalas bem diferentes (gerar roteiro custa cota da IA; marcar progresso
// é barato mas pode ser chamado com muito mais frequência num uso legítimo,
// com vários membros da equipe no mesmo evento). `keyFn` deixa escolher se o
// limite é por IP (padrão, rotas sem login) ou por conta (rotas autenticadas
// — precisa rodar depois do `requireAuth` pra `req.user` já existir).
function makeRateLimiter(windowMs, max, message, keyFn) {
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

const rateLimit = makeRateLimiter(
  15 * 60 * 1000, 10,
  'Muitas gerações em pouco tempo. Espere alguns minutos e tente de novo.'
);
// limite por conta, mais apertado que o de IP acima — a IP protege contra
// abuso vindo de fora; esse aqui é o "uso justo" de quem já está logado,
// enquanto não existe um plano pago pra abrir mais que isso.
const generateRateLimit = makeRateLimiter(
  15 * 60 * 1000, 3,
  'Você já gerou 3 roteiros nos últimos 15 minutos. Espere um pouco e tente de novo.',
  (req) => req.user.id
);
const progressRateLimit = makeRateLimiter(
  60 * 1000, 120,
  'Muitas atualizações de progresso em pouco tempo. Espere um instante e tente de novo.'
);

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

// Cliente com a service role — ignora RLS. Usado SÓ em operações internas que
// não podem passar pelo JWT de um usuário comum: gravar a conta Google
// conectada no callback do OAuth (não tem sessão de usuário nesse request, é
// um redirect vindo direto do Google), ler o token da conta do DONO do
// evento durante a sincronização, mesmo quando quem salvou foi um editor
// autorizado (não o dono), e resolver o email de um membro a partir do
// user_id (o email mora em auth.users, fora do alcance do client anon/
// authenticated). Nunca exposto ao cliente (diferente da anon key, que já é
// enviada via /api/config).
const supabaseAdmin = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
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

// ---------- criptografia dos tokens do Google (AES-256-GCM) ----------
// Tokens de refresh do Google não expiram sozinhos: se vazassem em texto
// puro num dump do banco, dariam controle contínuo da agenda de alguém.
// A chave só existe aqui no servidor (env var), nunca no banco.

const ENC_ALGO = 'aes-256-gcm';

function getEncKey() {
  const raw = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || '', 'base64');
  if (raw.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY ausente ou inválida (precisa de 32 bytes em base64).');
  return raw;
}

function encryptToken(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENC_ALGO, getEncKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

function decryptToken(stored) {
  const [ivB64, tagB64, dataB64] = String(stored || '').split(':');
  const decipher = crypto.createDecipheriv(ENC_ALGO, getEncKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

// ---------- state assinado do fluxo OAuth (anti-CSRF) ----------
// Sem isso, alguém poderia forçar a vítima a conectar a conta do ATACANTE
// na conta da vítima no CAPTURA (ataque conhecido de OAuth sem state validado).

function signState(payload) {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.OAUTH_STATE_SECRET || '').update(json).digest('base64url');
  return `${json}.${sig}`;
}

function verifyState(state) {
  const [json, sig] = String(state || '').split('.');
  if (!json || !sig) return null;
  const expected = crypto.createHmac('sha256', process.env.OAUTH_STATE_SECRET || '').update(json).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(json, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

app.get('/api/config', (req, res) => {
  res.json({ supabaseUrl: process.env.SUPABASE_URL || '', supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '' });
});

const ICONS = ['pin', 'gear', 'mic', 'play', 'users', 'cup', 'chat', 'flag', 'film', 'box', 'signal', 'heart'];

const CHECKLIST_SCHEMA = z.object({
  event_title: z.string().describe('Nome do evento. Se o texto não disser explicitamente, infira algo curto e razoável.'),
  phases: z.array(z.object({
    key: z.string().describe('Identificador curto em snake_case, sem acento, ex: chegada'),
    label: z.string().describe('Nome legível da fase, ex: Chegada & Preparação'),
    icon: z.enum(ICONS)
  })).describe('Momentos/fases do evento, na ordem em que acontecem (ex: chegada, cerimônia, festa).'),
  scenes: z.array(z.object({
    phase: z.string().describe('Deve bater exatamente com um "key" de alguma fase em phases.'),
    order: z.number().int().describe('Ordem da cena dentro do roteiro geral, começando em 1.'),
    title: z.string(),
    icon: z.enum(ICONS),
    formato: z.string().describe('Ex: "Story ao vivo" ou "Reels (editado)". Use o que o texto indicar; se não indicar, use "Story ao vivo".'),
    capture: z.array(z.string()).describe('Lista curta do que captar nessa cena.'),
    speech: z.string().describe('Fala/legenda sugerida, se houver no texto original. String vazia se não houver.'),
    can: z.array(z.string()).describe('O que pode fazer nessa cena. Pode ser vazio.'),
    cannot: z.array(z.string()).describe('O que não pode fazer nessa cena. Pode ser vazio.')
  })).describe('Cada cena/momento individual do roteiro a ser capturado.'),
  missions: z.array(z.object({
    key: z.string(),
    emoji: z.string().describe('Um emoji representando a categoria.'),
    label: z.string(),
    items: z.array(z.string())
  })).describe('Categorias de momentos soltos para flagrar a qualquer hora, sem ordem fixa (se o texto tiver algo assim). Array vazio se não houver.')
});

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

const CHECKLIST_OUTPUT_FORMAT = zodOutputFormat(CHECKLIST_SCHEMA);

async function generateWithRetry(anthropic, params, retries = 2, delayMs = 1000) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await anthropic.messages.parse(params);
    } catch (err) {
      const isTransient = err instanceof Anthropic.RateLimitError || (err instanceof Anthropic.APIError && err.status >= 500);
      if (!isTransient || attempt >= retries) throw err;
      await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
}

app.post('/api/parse-roteiro', rateLimit, requireAuth, generateRateLimit, async (req, res) => {
  const { text } = req.body || {};

  if (!text || typeof text !== 'string' || text.trim().length < 20) {
    return res.status(400).json({ error: 'Cole um roteiro com mais conteúdo antes de gerar.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY não configurada no servidor. Copie .env.example para .env e adicione sua chave (console.anthropic.com/settings/keys).'
    });
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await generateWithRetry(anthropic, {
      model: 'claude-haiku-4-5',
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
      output_config: { format: CHECKLIST_OUTPUT_FORMAT }
    });

    if (!response.parsed_output) {
      return res.status(502).json({ error: 'Não consegui estruturar esse texto. Tente reformular ou detalhar mais o roteiro.' });
    }

    res.json(response.parsed_output);
  } catch (err) {
    logError('Erro ao chamar a API da Anthropic:', err);
    if (err instanceof Anthropic.RateLimitError || (err instanceof Anthropic.APIError && err.status >= 500)) {
      return res.status(503).json({ error: 'A IA está sobrecarregada no momento. Tente gerar de novo em alguns segundos.' });
    }
    res.status(500).json({ error: 'Erro ao chamar a IA (Anthropic). Verifique a ANTHROPIC_API_KEY e a conexão.' });
  }
});

// ---------- Google Calendar (OAuth) ----------

// drive.file: só arquivos/pastas que o próprio CAPTURA criar, nunca o Drive
// inteiro da pessoa. O código só chama o endpoint de criar pasta — nunca o
// de upload de conteúdo — então essa permissão nunca é usada além disso.
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.file'
];

function buildGoogleRedirectUri(req) {
  return `${req.protocol}://${req.get('host')}/api/google/oauth/callback`;
}

function googleOAuthClient(req) {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, req ? buildGoogleRedirectUri(req) : undefined);
}

app.get('/api/google/connect', requireAuth, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !supabaseAdmin) {
    return res.status(500).json({ error: 'Integração com Google Calendar não configurada no servidor.' });
  }
  const returnTo = /^\/e\/[a-zA-Z0-9-]+$/.test(req.query.returnTo || '') ? req.query.returnTo : '/historico';
  const state = signState({ uid: req.user.id, returnTo, exp: Date.now() + 10 * 60 * 1000 });
  const url = googleOAuthClient(req).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state
  });
  res.json({ url });
});

app.get('/api/google/oauth/callback', async (req, res) => {
  const payload = verifyState(req.query.state);
  if (!payload) {
    return res.status(400).send('Link de conexão inválido ou expirado. Feche esta aba e tente conectar de novo.');
  }
  if (!supabaseAdmin) {
    return res.status(500).send('Integração com Google Calendar não configurada no servidor.');
  }
  try {
    const oauth2Client = googleOAuthClient(req);
    const { tokens } = await oauth2Client.getToken(req.query.code);
    if (!tokens.refresh_token) {
      return res.status(400).send('O Google não devolveu permissão de acesso contínuo. Desconecte o CAPTURA em myaccount.google.com/permissions e tente conectar de novo.');
    }
    oauth2Client.setCredentials(tokens);
    const info = await oauth2Client.getTokenInfo(tokens.access_token).catch(() => null);

    const { error } = await supabaseAdmin.from('google_calendar_accounts').upsert({
      user_id: payload.uid,
      google_email: info?.email || null,
      refresh_token_enc: encryptToken(tokens.refresh_token),
      access_token_enc: tokens.access_token ? encryptToken(tokens.access_token) : null,
      access_token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null
    });
    if (error) {
      logError('Erro ao salvar conta Google:', error);
      return res.status(500).send('Erro ao salvar a conexão com o Google Calendar.');
    }
    res.redirect(payload.returnTo + '?google=conectado');
  } catch (err) {
    logError('Erro no callback OAuth do Google:', err);
    res.status(500).send('Erro ao conectar com o Google. Feche esta aba e tente de novo.');
  }
});

app.get('/api/google/status', requireAuth, async (req, res) => {
  const db = scopedClient(req.token);
  const { data } = await db.from('google_calendar_accounts').select('google_email').eq('user_id', req.user.id).maybeSingle();
  res.json({ connected: !!data, email: data?.google_email || null });
});

app.post('/api/google/disconnect', requireAuth, async (req, res) => {
  const db = scopedClient(req.token);
  const { error } = await db.from('google_calendar_accounts').delete().eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: 'Não consegui desconectar.' });
  res.json({ ok: true });
});

async function getValidGoogleAccessToken(userId) {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.from('google_calendar_accounts').select('*').eq('user_id', userId).maybeSingle();
  if (error || !data) return null;

  const expiresAt = data.access_token_expires_at ? new Date(data.access_token_expires_at).getTime() : 0;
  if (data.access_token_enc && expiresAt > Date.now() + 60 * 1000) {
    return decryptToken(data.access_token_enc);
  }

  const oauth2Client = googleOAuthClient(null);
  oauth2Client.setCredentials({ refresh_token: decryptToken(data.refresh_token_enc) });
  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    await supabaseAdmin.from('google_calendar_accounts').update({
      access_token_enc: encryptToken(credentials.access_token),
      access_token_expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null
    }).eq('user_id', userId);
    return credentials.access_token;
  } catch (err) {
    // refresh_token revogado ou expirado (ex: a pessoa tirou o acesso do
    // CAPTURA em myaccount.google.com/permissions) — o Google recusa com
    // "invalid_grant" e não tem como recuperar sem reconectar do zero.
    // Apaga a conexão salva pra "Meus eventos" voltar a mostrar o botão de
    // conectar, em vez de continuar dizendo "conectado" pra um token morto.
    const isInvalidGrant = err.message === 'invalid_grant' || err.response?.data?.error === 'invalid_grant';
    if (isInvalidGrant) {
      await supabaseAdmin.from('google_calendar_accounts').delete().eq('user_id', userId);
    }
    logError('Erro ao renovar token do Google:', err);
    return null;
  }
}

// Best-effort: uma falha aqui nunca pode impedir a publicação/edição do
// evento, que é a função principal do site. Só loga e segue.
async function syncEventToGoogleCalendar(req, eventRow) {
  try {
    if (!eventRow.owner_id) return;
    const data = eventRow.data || {};
    if (!data.event_date) return;

    const accessToken = await getValidGoogleAccessToken(eventRow.owner_id);
    if (!accessToken) return; // dono não conectou o Google Calendar

    const start = new Date(data.event_date);
    if (isNaN(start.getTime())) return;
    let end = data.event_end_date ? new Date(data.event_end_date) : null;
    if (!end || isNaN(end.getTime()) || end <= start) {
      end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    }

    const link = `${req.protocol}://${req.get('host')}/e/${eventRow.id}`;
    const body = {
      summary: data.event_title || 'Evento',
      location: data.event_location || undefined,
      description: 'Checklist do CAPTURA: ' + link,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() }
    };

    const existingId = eventRow.google_calendar_event_id;
    const url = existingId
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${existingId}`
      : 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

    const resp = await fetch(url, {
      method: existingId ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const bodyText = await resp.text();
      logError('Erro ao sincronizar com Google Calendar:', new Error(`Google Calendar API ${resp.status}: ${bodyText}`));
      return;
    }
    const result = await resp.json();
    if (!existingId && result.id && supabaseAdmin) {
      await supabaseAdmin.from('events').update({ google_calendar_event_id: result.id }).eq('id', eventRow.id);
    }
  } catch (err) {
    logError('Erro ao sincronizar com Google Calendar:', err);
  }
}

async function driveCreateFolder(accessToken, name, parentId) {
  const body = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  const resp = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const e = new Error('drive create failed');
    e.status = resp.status;
    throw e;
  }
  return resp.json();
}

// Busca uma subpasta já existente com esse nome dentro do pai antes de criar
// — usado só ao editar uma estrutura já publicada, pra "adicionar pastas
// novas" nunca duplicar uma que a equipe já está usando (e pode já ter
// arquivo dentro).
async function driveFindFolder(accessToken, name, parentId) {
  const safeName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `name='${safeName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const resp = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return (data.files && data.files[0]) || null;
}

async function driveFindOrCreateFolder(accessToken, name, parentId) {
  const existing = await driveFindFolder(accessToken, name, parentId);
  if (existing) return existing;
  return driveCreateFolder(accessToken, name, parentId);
}

// Cada item de "folders" pode ser um caminho tipo "Final/Fotos finais" —
// "/" separa níveis de pasta. Um cache por caminho já percorrido evita criar
// a mesma pasta intermediária duas vezes quando várias linhas compartilham
// um ancestral (ex: "Final/Fotos finais" e "Final/Vídeos finais" só criam
// "Final" uma vez).
//
// `existingRootId` diferencia os dois modos: sem ele, cria uma pasta raiz
// nova (evento publicado pela primeira vez) e todo o resto é garantidamente
// novo, sem custo extra de checar duplicata. Com ele (edição de uma
// estrutura já criada), a raiz já existe e cada nível usa find-or-create —
// nomes que já existem são reaproveitados (nunca duplicados, nunca
// apagados), só o que for realmente novo é criado.
async function driveCreateFolderTree(accessToken, rootName, paths, existingRootId) {
  const root = existingRootId ? { id: existingRootId } : await driveCreateFolder(accessToken, rootName, null);
  const idByPath = new Map();

  for (const rawPath of paths) {
    const segments = String(rawPath).split('/').map(s => s.trim()).filter(Boolean);
    let parentId = root.id;
    let currentPath = '';
    for (const segment of segments) {
      currentPath = currentPath ? currentPath + '/' + segment : segment;
      if (idByPath.has(currentPath)) {
        parentId = idByPath.get(currentPath);
        continue;
      }
      const folder = existingRootId
        ? await driveFindOrCreateFolder(accessToken, segment, parentId)
        : await driveCreateFolder(accessToken, segment, parentId);
      idByPath.set(currentPath, folder.id);
      parentId = folder.id;
    }
  }
  return root;
}

// Diferente da sincronização do Calendar (automática a cada publicação),
// criar pastas no Drive é uma ação explícita — só roda quando a pessoa
// clica no botão, nunca em segundo plano.
app.post('/api/google/drive-folders', requireAuth, async (req, res) => {
  const { eventTitle, folders, existingRootId } = req.body || {};
  if (!Array.isArray(folders) || !folders.length) {
    return res.status(400).json({ error: 'Adicione pelo menos uma pasta.' });
  }
  const accessToken = await getValidGoogleAccessToken(req.user.id);
  if (!accessToken) {
    return res.status(400).json({ error: 'Conecte sua conta do Google primeiro (em "Meus eventos").' });
  }
  try {
    const root = await driveCreateFolderTree(accessToken, eventTitle || 'Evento CAPTURA', folders, typeof existingRootId === 'string' ? existingRootId : null);
    res.json({ folderId: root.id, folderUrl: `https://drive.google.com/drive/folders/${root.id}` });
  } catch (err) {
    logError('Erro ao criar estrutura no Drive:', err);
    const scopeIssue = err.status === 403;
    res.status(500).json({
      error: scopeIssue
        ? 'Sua conexão com o Google não inclui acesso ao Drive ainda — desconecte e conecte de novo em "Meus eventos".'
        : 'Não consegui criar a estrutura no Drive. Tente de novo.'
    });
  }
});

function validEventPayload(body) {
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

app.post('/api/events', requireAuth, async (req, res) => {
  const payload = validEventPayload(req.body);
  if (!payload) {
    return res.status(400).json({ error: 'Formato de evento inválido.' });
  }

  const id = crypto.randomUUID().split('-')[0];
  const driveFolderId = typeof req.body.drive_folder_id === 'string' ? req.body.drive_folder_id : null;
  const db = scopedClient(req.token);
  const { error } = await db.from('events').insert({ id, data: payload, owner_id: req.user.id, drive_folder_id: driveFolderId });
  if (error) {
    logError('Erro ao salvar evento:', error);
    return res.status(500).json({ error: 'Não consegui salvar o evento. Tente de novo.' });
  }
  res.json({ id });
  syncEventToGoogleCalendar(req, { id, owner_id: req.user.id, data: payload, google_calendar_event_id: null });
});

app.patch('/api/events/:id', requireAuth, async (req, res) => {
  const payload = validEventPayload(req.body);
  if (!payload) {
    return res.status(400).json({ error: 'Formato de evento inválido.' });
  }

  const updateFields = { data: payload };
  if (typeof req.body.drive_folder_id === 'string') updateFields.drive_folder_id = req.body.drive_folder_id;

  const db = scopedClient(req.token);
  const { data, error } = await db
    .from('events')
    .update(updateFields)
    .eq('id', req.params.id)
    .select('id, owner_id, google_calendar_event_id')
    .maybeSingle();

  if (error) {
    logError('Erro ao atualizar evento:', error);
    return res.status(500).json({ error: 'Não consegui salvar as alterações. Tente de novo.' });
  }
  if (!data) {
    return res.status(404).json({ error: 'Evento não encontrado ou você não tem permissão pra editar.' });
  }
  res.json({ id: data.id });
  syncEventToGoogleCalendar(req, { id: data.id, owner_id: data.owner_id, data: payload, google_calendar_event_id: data.google_calendar_event_id });
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
    logError('Erro ao atualizar permissão:', error);
    return res.status(500).json({ error: 'Não consegui atualizar a permissão.' });
  }
  if (!data) {
    return res.status(404).json({ error: 'Evento não encontrado ou você não é o dono dele.' });
  }
  res.json({ allow_member_edit: allow });
});

app.get('/api/events/:id/members', requireAuth, async (req, res) => {
  const db = scopedClient(req.token);
  const { data: event, error: eventError } = await db
    .from('events')
    .select('owner_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (eventError) {
    logError('Erro ao checar dono do evento:', eventError);
    return res.status(500).json({ error: 'Não consegui carregar a equipe.' });
  }
  if (!event) return res.status(404).json({ error: 'Evento não encontrado.' });
  if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Só o dono do evento pode ver a equipe.' });

  const { data: members, error } = await db
    .from('event_members')
    .select('user_id, can_edit, created_at')
    .eq('event_id', req.params.id)
    .order('created_at', { ascending: true });
  if (error) {
    logError('Erro ao listar membros do evento:', error);
    return res.status(500).json({ error: 'Não consegui carregar a equipe.' });
  }

  const withEmail = await Promise.all((members || []).map(async (m) => {
    let email = null;
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
      email = data?.user?.email || null;
    }
    return { user_id: m.user_id, email, can_edit: !!m.can_edit, created_at: m.created_at };
  }));

  res.json({ members: withEmail });
});

app.patch('/api/events/:id/members/:userId', requireAuth, async (req, res) => {
  const canEdit = !!req.body.can_edit;
  const db = scopedClient(req.token);
  const { data, error } = await db
    .from('event_members')
    .update({ can_edit: canEdit })
    .eq('event_id', req.params.id)
    .eq('user_id', req.params.userId)
    .select('user_id')
    .maybeSingle();
  if (error) {
    logError('Erro ao atualizar permissão do membro:', error);
    return res.status(500).json({ error: 'Não consegui atualizar a permissão desse membro.' });
  }
  if (!data) return res.status(404).json({ error: 'Membro não encontrado ou você não é o dono do evento.' });
  res.json({ user_id: data.user_id, can_edit: canEdit });
});

app.get('/api/events', requireAuth, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY não configuradas no servidor.' });
  }

  const db = scopedClient(req.token);
  const [{ data: owned, error: ownedError }, { data: memberships, error: memberError }] = await Promise.all([
    db.from('events').select('id, data, created_at').eq('owner_id', req.user.id),
    db.from('event_members').select('event_id, can_edit').eq('user_id', req.user.id)
  ]);

  if (ownedError || memberError) {
    logError('Erro ao listar eventos:', ownedError || memberError);
    return res.status(500).json({ error: 'Não consegui carregar seu histórico.' });
  }

  const canEditByEventId = new Map((memberships || []).map((m) => [m.event_id, !!m.can_edit]));
  const memberIds = (memberships || []).map((m) => m.event_id).filter((id) => !owned.some((o) => o.id === id));
  let memberEvents = [];
  if (memberIds.length) {
    const { data, error } = await db.from('events').select('id, data, created_at').in('id', memberIds);
    if (error) {
      logError('Erro ao listar eventos salvos:', error);
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
      is_editor: !row.is_owner && !!canEditByEventId.get(row.id)
    }))
  });
});

app.get('/api/events/:id/save', requireAuth, async (req, res) => {
  const db = scopedClient(req.token);
  const { data, error } = await db
    .from('event_members')
    .select('event_id, can_edit')
    .eq('event_id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error) {
    logError('Erro ao checar evento salvo:', error);
    return res.status(500).json({ error: 'Não consegui checar.' });
  }
  res.json({ saved: !!data, can_edit: !!data?.can_edit });
});

app.post('/api/events/:id/save', requireAuth, async (req, res) => {
  const db = scopedClient(req.token);
  const { error } = await db.from('event_members').insert({ event_id: req.params.id, user_id: req.user.id });
  if (error && error.code !== '23505') {
    logError('Erro ao salvar evento:', error);
    return res.status(500).json({ error: 'Não consegui salvar esse evento na sua conta.' });
  }
  const { data: membership } = await db
    .from('event_members')
    .select('can_edit')
    .eq('event_id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  res.json({ saved: true, can_edit: !!membership?.can_edit });
});

app.delete('/api/events/:id/save', requireAuth, async (req, res) => {
  const db = scopedClient(req.token);
  const { error } = await db
    .from('event_members')
    .delete()
    .eq('event_id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) {
    logError('Erro ao remover evento salvo:', error);
    return res.status(500).json({ error: 'Não consegui remover esse evento da sua conta.' });
  }
  res.json({ saved: false });
});

app.get('/api/events/:id', async (req, res) => {
  if (!supabase || !supabaseAdmin) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY não configuradas no servidor.' });
  }

  const id = req.params.id;
  // service role (não a anon key) de propósito: a policy de SELECT do `events` não
  // libera mais a role `anon` (só assim dava pra alguém buscar a tabela inteira direto
  // no PostgREST usando a mesma anon key pública que o navegador recebe via /api/config,
  // ignorando esse filtro por id). O `event_progress` continua com a role `anon`, que
  // segue liberada nele de propósito.
  const [{ data: row, error }, { data: progressRows }] = await Promise.all([
    supabaseAdmin.from('events').select('data, owner_id, allow_member_edit, drive_folder_id').eq('id', id).maybeSingle(),
    supabase.from('event_progress').select('action, payload').eq('event_id', id).order('created_at', { ascending: true })
  ]);

  if (error || !row) {
    return res.status(404).json({ error: 'Evento não encontrado. O link pode estar errado ou o evento foi removido.' });
  }
  res.json({ ...row.data, owner_id: row.owner_id, allow_member_edit: !!row.allow_member_edit, drive_folder_id: row.drive_folder_id || null, progress: foldProgress(progressRows || []) });
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

app.post('/api/events/:id/progress', progressRateLimit, async (req, res) => {
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
    logError('Erro ao salvar progresso:', error);
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

// Rede de segurança pra erro que escapou de todo try/catch das rotas acima
// (as rotas já tratam seus próprios erros e nunca chegam a chamar next(err),
// então isso raramente dispara — quem cobre o dia a dia é o logError).
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CAPTURA rodando em http://localhost:${PORT}`);
});
