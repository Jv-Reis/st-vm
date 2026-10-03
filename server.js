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
import { createCalendarWorker } from './lib/calendar-sync.js';
import * as Sentry from '@sentry/node';
import { foldProgress, validEventPayload, splitDriveFolderPath, makeRateLimiter, filterValidEmails } from './lib/pure.js';
import { decideAccess, isValidShareToken, isValidEventId, normalizeShareMode, stripPrivateFields, canResetProgress } from './lib/access.js';
import { createInviteProcessor, normalizeEmailList, summarizeInvites } from './lib/member-invites.js';
import { createWorkerLogger } from './lib/transient.js';
import { sanitizeProgressPayload } from './lib/progress-payload.js';

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

// Workers em segundo plano (Calendar, convites): queda passageira do Supabase
// vira só aviso no log; só vai pro Sentry se durar vários minutos seguidos.
const logWorkerError = createWorkerLogger({ logError });

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

// supabase-js servido pelo próprio app (versão travada no package-lock), em
// vez de CDN externo: o service worker só guarda arquivos da mesma origem, e
// sem essa biblioteca o app não abre offline.
app.get('/vendor/supabase.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'));
});

app.use(express.static(path.join(__dirname, 'public')));

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
// por evento (somando todo mundo que escreve nele, de qualquer IP): o limite
// por IP sozinho não segura vários IPs no mesmo evento. 60/min é bem mais que
// uma equipe real marca, e limita o pior caso de gravação a ~17 MB por dia.
const progressEventLimit = makeRateLimiter(
  60 * 1000, 60,
  'Muitas atualizações neste evento em pouco tempo. Espere um instante e tente de novo.'
);
const resetEventLimit = makeRateLimiter(
  60 * 60 * 1000, 3,
  'Este checklist já foi reiniciado 3 vezes na última hora. Espere um pouco antes de reiniciar de novo.'
);
// usa o limitador (feito pra middleware) dentro de um handler, com chave própria
function passesLimit(limiter, key, res) {
  let passed = false;
  limiter({ ip: key }, res, () => { passed = true; });
  return passed;
}
// por conta, não por IP — convite manda email de verdade (Supabase Auth), então
// existe custo real de abuso além de carga no servidor.
const addMemberRateLimit = makeRateLimiter(
  60 * 60 * 1000, 20,
  'Muitos membros adicionados na última hora. Espere um pouco e tente de novo.',
  (req) => req.user.id
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

// Progresso é marcado várias vezes por minuto; sem esse cache cada marcação
// faria uma ida ao Supabase Auth só pra saber quem é a pessoa.
const userCache = new Map(); // jwt -> { user, exp }
async function userFromToken(token) {
  if (!token || !supabase) return null;
  const hit = userCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  if (userCache.size > 1000) userCache.clear();
  userCache.set(token, { user: data.user, exp: Date.now() + 60 * 1000 });
  return data.user;
}

async function requireAuth(req, res, next) {
  if (!supabase) return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY não configuradas no servidor.' });
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Login necessário.' });
  const user = await userFromToken(token);
  if (!user) return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  req.user = user;
  req.token = token;
  next();
}

// Login opcional: rotas públicas (evento por link) também servem a equipe logada.
async function optionalUser(req) {
  return userFromToken(getBearerToken(req));
}

const appBaseUrl = process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + (process.env.PORT || 3000);

function requestBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
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

// A fila é preenchida por triggers na mesma transação dos eventos/membros.
const runCalendarSync = createCalendarWorker({
  db: supabaseAdmin, getToken: getValidGoogleAccessToken,
  baseUrl: appBaseUrl,
  logError: logWorkerError
});
if (supabaseAdmin) {
  setInterval(runCalendarSync, 15000).unref();
  setTimeout(runCalendarSync, 1000).unref();
}

app.get('/api/google/permissions', requireAuth, async (req, res) => {
  try {
    const { data, error } = await scopedClient(req.token).from('calendar_permissions').select('organizer_id,created_at');
    if (error) throw error;
    const permissions = await Promise.all(data.map(async p => {
      const result = await supabaseAdmin.auth.admin.getUserById(p.organizer_id);
      if (result.error) throw result.error;
      return { ...p, email: result.data.user.email };
    }));
    res.json({ permissions });
  } catch (err) {
    logError('Erro ao listar autorizações:', err);
    res.status(503).json({ error: 'Não foi possível carregar as autorizações. Tente novamente mais tarde.' });
  }
});

app.post('/api/google/permissions', requireAuth, addMemberRateLimit, async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  if (!filterValidEmails([email]).length) return res.status(400).json({ error: 'Informe um email válido.' });
  const db = scopedClient(req.token);
  const account = await db.from('google_calendar_accounts').select('user_id').eq('user_id', req.user.id).maybeSingle();
  if (account.error || !account.data) return res.status(409).json({ error: 'Conecte seu Google antes de autorizar alguém.' });
  const { error } = await db.rpc('authorize_calendar_organizer', { p_email: email });
  if (error) return res.status(400).json({ error: 'Não foi possível autorizar. Confira se esse email pertence a outra pessoa com conta no CAPTURA.' });
  res.json({ ok: true });
  runCalendarSync();
});

app.delete('/api/google/permissions/:organizerId', requireAuth, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.organizerId)) return res.status(400).json({ error: 'Pessoa inválida.' });
  const { error } = await scopedClient(req.token).from('calendar_permissions').delete()
    .eq('recipient_id', req.user.id).eq('organizer_id', req.params.organizerId);
  if (error) return res.status(500).json({ error: 'Não consegui revogar a autorização.' });
  res.json({ ok: true });
});

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
    const segments = splitDriveFolderPath(rawPath);
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

// ---------- convites de membros (fila persistente) ----------
// O dono enfileira os emails (RPC com checagem de posse); o processamento usa
// a service role. Parte roda dentro do próprio request de salvar (tempo
// limitado, pra publicação continuar rápida) e o resto fica com o worker,
// que retoma inclusive depois de reiniciar o servidor.
const inviteProcessor = createInviteProcessor({
  admin: supabaseAdmin,
  inviteUser: (email, redirectTo) => supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo }),
  logError: logWorkerError
});
const INVITE_REQUEST_BUDGET_MS = 4000;

let inviteMigrationWarned = false;
async function runInvites(options) {
  try {
    return await inviteProcessor.run(options);
  } catch (err) {
    // Servidor novo contra banco sem supabase-access-control.sql: avisa uma
    // vez em vez de a cada ciclo do worker.
    if (err?.code === 'PGRST202') {
      if (!inviteMigrationWarned) console.error('Fila de convites desativada: execute supabase-access-control.sql no Supabase.');
      inviteMigrationWarned = true;
      return [];
    }
    logWorkerError('Fila de convites indisponível:', err);
    return [];
  }
}

if (supabaseAdmin) {
  setInterval(() => runInvites({ budgetMs: 15000, baseUrl: appBaseUrl }), 20000).unref();
  setTimeout(() => runInvites({ budgetMs: 15000, baseUrl: appBaseUrl }), 3000).unref();
}

async function readInviteRows(db, eventId, emails) {
  let query = db.from('event_member_invites').select('event_id, email, status, attempts, last_error, updated_at').eq('event_id', eventId);
  if (emails) query = query.in('email', emails);
  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Garante que cada email listado vire (ou já seja) um convite rastreado e
// devolve o resumo do que aconteceu neste salvamento. `previousEmails` evita
// repetir avisos de quem já estava na lista antes.
async function syncMemberInvites(req, eventId, emails, { isOwner, previousEmails = [] }) {
  const { valid, invalid } = normalizeEmailList(emails);
  const before = normalizeEmailList(previousEmails);
  const previousValid = new Set(before.valid);
  const previousInvalid = new Set(before.invalid.map(e => e.toLowerCase()));
  if (!isOwner) {
    // editores podem salvar o evento, mas só o dono inclui pessoas na equipe
    return summarizeInvites([], {
      invalid: invalid.filter(e => !previousInvalid.has(e.toLowerCase())),
      skipped: valid.filter(e => !previousValid.has(e)).map(email => ({ email, error: 'Só o dono do evento pode adicionar membros.' }))
    });
  }
  if (!valid.length) return summarizeInvites([], { invalid });
  const db = scopedClient(req.token);
  const preexisting = new Map((await readInviteRows(db, eventId, valid)).map(r => [r.email, r.status]));
  const { error } = await db.rpc('enqueue_member_invites', { p_event_id: eventId, p_emails: valid, p_retry_failed: false });
  if (error) throw error;
  await runInvites({ eventId, budgetMs: INVITE_REQUEST_BUDGET_MS, baseUrl: requestBaseUrl(req) });
  return summarizeInvites(await readInviteRows(db, eventId, valid), { invalid, preexisting });
}

// Falha nos convites nunca derruba o salvamento do evento em si.
async function safeSyncMemberInvites(req, eventId, emails, options) {
  try {
    return await syncMemberInvites(req, eventId, emails, options);
  } catch (err) {
    logError('Erro ao registrar convites:', err);
    const { valid, invalid } = normalizeEmailList(emails);
    return summarizeInvites([], {
      invalid,
      skipped: valid.map(email => ({ email, error: 'Não foi possível registrar o convite agora. Tente reenviar.' }))
    });
  }
}

// ---------- modo de acesso / link compartilhável ----------

function sharePayload(row) {
  const legacyUntil = row?.legacy_link_until || null;
  return {
    share_mode: row?.share_mode || 'team',
    share_path: row?.share_token ? '/s/' + row.share_token : null,
    token_created_at: row?.token_created_at || null,
    legacy_link_until: legacyUntil,
    legacy_active: !!legacyUntil && new Date(legacyUntil).getTime() > Date.now()
  };
}

async function readShare(db, eventId) {
  const { data, error } = await db.from('event_access')
    .select('share_mode, share_token, token_created_at, legacy_link_until').eq('event_id', eventId).maybeSingle();
  if (error) throw error;
  return data;
}

const EVENT_COLUMNS = 'id, data, owner_id, allow_member_edit, drive_folder_id, notes, revision';

app.post('/api/events', requireAuth, async (req, res) => {
  const payload = validEventPayload(req.body);
  if (!payload) {
    return res.status(400).json({ error: 'Formato de evento inválido.' });
  }

  const id = crypto.randomUUID().split('-')[0];
  const driveFolderId = typeof req.body.drive_folder_id === 'string' ? req.body.drive_folder_id : null;
  const allowMemberEdit = !!req.body.allow_member_edit;
  const notes = typeof req.body.notes === 'string' ? req.body.notes.slice(0, 20000) : '';
  const shareMode = normalizeShareMode(req.body.share_mode);
  const db = scopedClient(req.token);
  const { data: created, error } = await db.from('events')
    .insert({ id, data: payload, owner_id: req.user.id, drive_folder_id: driveFolderId, allow_member_edit: allowMemberEdit, notes })
    .select('id, revision').single();
  if (error) {
    logError('Erro ao salvar evento:', error);
    return res.status(500).json({ error: 'Não consegui salvar o evento. Tente de novo.' });
  }
  runCalendarSync();

  let share = null;
  try {
    // a linha de acesso nasce no trigger como "colaborar"; só muda se pedido
    if (shareMode && shareMode !== 'collab') {
      const { error: modeError } = await db.rpc('set_event_share_mode', { p_event_id: id, p_mode: shareMode });
      if (modeError) throw modeError;
    }
    share = sharePayload(await readShare(db, id));
  } catch (err) {
    logError('Erro ao configurar compartilhamento do evento novo:', err);
  }

  const members = await safeSyncMemberInvites(req, id, payload.member_emails, { isOwner: true });
  res.json({ id, revision: created?.revision ?? 1, share, members });
});

app.patch('/api/events/:id', requireAuth, async (req, res) => {
  const payload = validEventPayload(req.body);
  if (!payload) {
    return res.status(400).json({ error: 'Formato de evento inválido.' });
  }
  const baseRevision = Number.isInteger(req.body.base_revision) ? req.body.base_revision : null;
  if (baseRevision === null) {
    // app antigo em cache, sem controle de versão: não deixa sobrescrever às cegas
    return res.status(428).json({ code: 'revision_required', error: 'Recarregue a página pra editar com a versão mais recente do evento.' });
  }

  const db = scopedClient(req.token);
  const { data: current, error: currentError } = await db.from('events').select(EVENT_COLUMNS).eq('id', req.params.id).maybeSingle();
  if (currentError) {
    logError('Erro ao carregar evento para editar:', currentError);
    return res.status(500).json({ error: 'Não consegui salvar as alterações. Tente de novo.' });
  }
  if (!current) {
    return res.status(404).json({ error: 'Evento não encontrado ou você não tem permissão pra editar.' });
  }
  const conflict = (latest) => res.status(409).json({
    code: 'conflict',
    error: 'Este evento foi alterado por outra pessoa.',
    current: { ...latest.data, id: latest.id, owner_id: latest.owner_id, allow_member_edit: !!latest.allow_member_edit,
      drive_folder_id: latest.drive_folder_id || null, notes: latest.notes || '', revision: latest.revision }
  });
  if (current.revision !== baseRevision) return conflict(current);

  const updateFields = { data: payload };
  if (typeof req.body.drive_folder_id === 'string') updateFields.drive_folder_id = req.body.drive_folder_id;
  if (typeof req.body.allow_member_edit === 'boolean') updateFields.allow_member_edit = req.body.allow_member_edit;
  if (typeof req.body.notes === 'string') updateFields.notes = req.body.notes.slice(0, 20000);

  // A condição na versão fecha a corrida entre ler e gravar: se outra pessoa
  // salvou nesse meio tempo, o update não encontra a linha.
  const { data, error } = await db
    .from('events')
    .update(updateFields)
    .eq('id', req.params.id)
    .eq('revision', baseRevision)
    .select('id, owner_id, revision')
    .maybeSingle();

  if (error) {
    logError('Erro ao atualizar evento:', error);
    return res.status(500).json({ error: 'Não consegui salvar as alterações. Tente de novo.' });
  }
  if (!data) {
    const { data: latest } = await db.from('events').select(EVENT_COLUMNS).eq('id', req.params.id).maybeSingle();
    if (latest && latest.revision !== baseRevision) return conflict(latest);
    return res.status(403).json({ error: 'Você não tem permissão pra editar este evento.' });
  }
  runCalendarSync();

  const isOwner = data.owner_id === req.user.id;
  let share = null;
  if (isOwner) {
    try {
      const shareMode = normalizeShareMode(req.body.share_mode);
      const before = await readShare(db, data.id);
      if (shareMode && shareMode !== before?.share_mode) {
        const { error: modeError } = await db.rpc('set_event_share_mode', { p_event_id: data.id, p_mode: shareMode });
        if (modeError) throw modeError;
        closeLinkStreams(data.id);
      }
      share = sharePayload(await readShare(db, data.id));
    } catch (err) {
      logError('Erro ao atualizar compartilhamento:', err);
    }
  }

  const members = await safeSyncMemberInvites(req, data.id, payload.member_emails, {
    isOwner, previousEmails: current.data?.member_emails
  });
  res.json({ id: data.id, revision: data.revision, share, members });
});

// Exclui o evento de verdade (só o dono) — event_members e event_progress
// cascateiam sozinhos via FK. Não mexe na
// pasta do Drive. A fila preserva os IDs do Calendar para excluir suas cópias.
app.delete('/api/events/:id', requireAuth, async (req, res) => {
  const db = scopedClient(req.token);
  const { data, error } = await db.from('events').delete().eq('id', req.params.id).select('id').maybeSingle();
  if (error) {
    logError('Erro ao excluir evento:', error);
    return res.status(500).json({ error: 'Não consegui excluir o evento.' });
  }
  if (!data) {
    return res.status(404).json({ error: 'Evento não encontrado ou você não é o dono dele.' });
  }
  res.json({ deleted: true });
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

// Salva o bloco de notas direto da tela ao vivo, sem precisar reenviar o
// evento inteiro (roteiro, cenas, missões...) só pra mudar um texto — ao
// contrário do PATCH /api/events/:id, que é pra tela de prévia/edição.
app.patch('/api/events/:id/notes', requireAuth, async (req, res) => {
  const notes = typeof req.body.notes === 'string' ? req.body.notes.slice(0, 20000) : '';
  const db = scopedClient(req.token);
  const { data, error } = await db
    .from('events')
    .update({ notes })
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();

  if (error) {
    logError('Erro ao salvar notas:', error);
    return res.status(500).json({ error: 'Não consegui salvar as notas.' });
  }
  if (!data) {
    return res.status(404).json({ error: 'Evento não encontrado ou você não tem permissão pra editar.' });
  }
  broadcastProgress(req.params.id, { action: 'notes', payload: { notes } });
  res.json({ notes });
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

// Adicionar uma pessoa pela tela "Gerenciar equipe". Diferente do salvamento
// do evento, aqui o pedido é explícito: um convite que tinha falhado volta
// pra fila e é tentado de novo.
app.post('/api/events/:id/members', requireAuth, addMemberRateLimit, async (req, res) => {
  const { valid } = normalizeEmailList([req.body && req.body.email]);
  const email = valid[0];
  if (!email) return res.status(400).json({ error: 'Email inválido.' });
  const db = scopedClient(req.token);
  const { data: before, error } = await db.rpc('enqueue_member_invites', { p_event_id: req.params.id, p_emails: [email], p_retry_failed: true });
  if (error) {
    if (String(error.message || '').includes('not event owner')) return res.status(403).json({ error: 'Só o dono do evento pode adicionar membros.' });
    logError('Erro ao enfileirar convite:', error);
    return res.status(500).json({ error: 'Não consegui adicionar esse membro.' });
  }
  const wasSettled = ['added', 'existing', 'invited'].includes(before?.[0]?.status);
  if (!wasSettled) await runInvites({ eventId: req.params.id, budgetMs: INVITE_REQUEST_BUDGET_MS, baseUrl: requestBaseUrl(req) });
  const [row] = await readInviteRows(db, req.params.id, [email]).catch(() => []);
  const status = wasSettled ? 'existing' : (row?.status === 'processing' ? 'pending' : (row?.status || 'pending'));
  res.json({ status, email, error: status === 'failed' ? (row?.last_error || 'Não foi possível convidar.') : null });
});

app.get('/api/events/:id/invites', requireAuth, async (req, res) => {
  try {
    const rows = await readInviteRows(scopedClient(req.token), req.params.id);
    res.json({ invites: rows, summary: summarizeInvites(rows) });
  } catch (err) {
    logError('Erro ao listar convites:', err);
    res.status(500).json({ error: 'Não consegui carregar os convites.' });
  }
});

// Reenvia só o que falhou; quem já foi adicionado ou convidado não recebe de novo.
app.post('/api/events/:id/invites/retry', requireAuth, addMemberRateLimit, async (req, res) => {
  const db = scopedClient(req.token);
  const { error } = await db.rpc('retry_failed_member_invites', { p_event_id: req.params.id });
  if (error) {
    if (String(error.message || '').includes('not event owner')) return res.status(403).json({ error: 'Só o dono do evento pode reenviar convites.' });
    logError('Erro ao reenviar convites:', error);
    return res.status(500).json({ error: 'Não consegui reenviar os convites.' });
  }
  await runInvites({ eventId: req.params.id, budgetMs: INVITE_REQUEST_BUDGET_MS, baseUrl: requestBaseUrl(req) });
  const rows = await readInviteRows(db, req.params.id).catch(() => []);
  res.json({ invites: rows, summary: summarizeInvites(rows) });
});

// ---------- compartilhamento (só o dono; conferido de novo nas RPCs) ----------

async function shareAction(req, res, action) {
  const db = scopedClient(req.token);
  try {
    const before = await readShare(db, req.params.id);
    if (!before) return res.status(404).json({ error: 'Evento não encontrado ou você não é o dono dele.' });
    if (action) {
      const { error } = await action(db);
      if (error) {
        if (String(error.message || '').includes('invalid share mode')) return res.status(400).json({ error: 'Modo de compartilhamento inválido.' });
        if (String(error.message || '').includes('not event owner')) return res.status(403).json({ error: 'Só o dono do evento pode mudar o compartilhamento.' });
        throw error;
      }
      closeLinkStreams(req.params.id);
    }
    res.json(sharePayload(await readShare(db, req.params.id)));
  } catch (err) {
    logError('Erro no compartilhamento do evento:', err);
    res.status(500).json({ error: 'Não consegui atualizar o compartilhamento.' });
  }
}

app.get('/api/events/:id/share', requireAuth, (req, res) => shareAction(req, res, null));

app.patch('/api/events/:id/share', requireAuth, (req, res) => {
  const mode = normalizeShareMode(req.body && req.body.share_mode);
  if (!mode) return res.status(400).json({ error: 'Modo de compartilhamento inválido.' });
  return shareAction(req, res, db => db.rpc('set_event_share_mode', { p_event_id: req.params.id, p_mode: mode }));
});

app.post('/api/events/:id/share/regenerate', requireAuth, (req, res) =>
  shareAction(req, res, db => db.rpc('regenerate_event_share_token', { p_event_id: req.params.id })));

app.delete('/api/events/:id/share', requireAuth, (req, res) =>
  shareAction(req, res, db => db.rpc('disable_event_share_link', { p_event_id: req.params.id })));

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

// Entrar na equipe sozinho só é permitido por um link de colaboração (ou pelo
// link antigo /e/<id>, enquanto durar a transição). Antes, qualquer conta se
// inseria em qualquer evento só conhecendo o ID.
async function joinEvent(req, res, rpcArgs) {
  const db = scopedClient(req.token);
  const { data: eventId, error } = await db.rpc('join_shared_event', rpcArgs);
  if (error) {
    return res.status(403).json({ code: 'join_not_allowed', error: 'Este link não permite entrar na equipe. Peça ao dono do evento pra te adicionar.' });
  }
  const { data: membership } = await db.from('event_members').select('can_edit')
    .eq('event_id', eventId).eq('user_id', req.user.id).maybeSingle();
  res.json({ saved: true, can_edit: !!membership?.can_edit, event_id: eventId });
}

app.post('/api/events/:id/save', requireAuth, (req, res) => joinEvent(req, res, { p_event_id: req.params.id }));

app.post('/api/share/:token/join', requireAuth, (req, res) => {
  if (!isValidShareToken(req.params.token)) return res.status(404).json({ code: 'link_invalid', error: LINK_INVALID_MSG });
  return joinEvent(req, res, { p_token: req.params.token });
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

// ---------- leitura pública / por equipe, progresso e tempo real ----------
// Toda leitura e escrita de progresso passa por aqui: o banco não aceita mais
// acesso direto de visitante (policies de event_progress fechadas), então é
// este trecho que aplica o modo de acesso de cada evento.

const LINK_INVALID_MSG = 'Este link foi desativado ou substituído. Peça o link atualizado a quem organiza o evento.';
const TEAM_ONLY_MSG = 'Este evento é restrito à equipe.';

async function roleFor(event, user) {
  if (!user) return null;
  if (event.owner_id && event.owner_id === user.id) return 'owner';
  const { data, error } = await supabaseAdmin.from('event_members').select('can_edit')
    .eq('event_id', event.id).eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  return data ? (data.can_edit ? 'editor' : 'member') : null;
}

// Devolve null quando o evento/link não existe; senão, o evento com a decisão.
async function resolveEventContext({ eventId = null, token = null, user = null }) {
  let access = null;
  if (token) {
    if (!isValidShareToken(token)) return null;
    const { data, error } = await supabaseAdmin.from('event_access').select('*').eq('share_token', token).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    access = data;
    eventId = data.event_id;
  } else if (!isValidEventId(eventId)) {
    return null;
  }
  const { data: event, error } = await supabaseAdmin.from('events').select(EVENT_COLUMNS).eq('id', eventId).maybeSingle();
  if (error) throw error;
  if (!event) return null;
  if (!access) {
    const result = await supabaseAdmin.from('event_access').select('*').eq('event_id', event.id).maybeSingle();
    if (result.error) throw result.error;
    access = result.data;
  }
  const role = await roleFor(event, user);
  const decision = decideAccess({
    role, via: token ? 'token' : 'id', shareMode: access?.share_mode,
    tokenMatches: !!token && access?.share_token === token, legacyUntil: access?.legacy_link_until
  });
  return { event, access, role, decision };
}

function eventResponse({ event, access, role, decision }, progressRows) {
  const isTeam = !!role;
  return {
    ...stripPrivateFields(event.data, isTeam),
    id: event.id,
    owner_id: isTeam ? event.owner_id : null,
    allow_member_edit: !!event.allow_member_edit,
    drive_folder_id: event.drive_folder_id || null,
    notes: event.notes || '',
    revision: event.revision ?? 1,
    progress: foldProgress(progressRows || []),
    access: {
      role: role || null,
      basis: decision.basis,
      can_write_progress: decision.canWriteProgress,
      share_mode: access?.share_mode || 'team',
      legacy_link_until: decision.basis === 'legacy' ? access.legacy_link_until : null
    }
  };
}

function deniedResponse(res, ctx, { token, user }) {
  if (!ctx) {
    return res.status(404).json(token
      ? { code: 'link_invalid', error: LINK_INVALID_MSG }
      : { code: 'not_found', error: 'Evento não encontrado. O link pode estar errado ou o evento foi removido.' });
  }
  return res.status(403).json({ code: 'team_only', error: TEAM_ONLY_MSG, login_required: !user });
}

async function sendEvent(req, res, { eventId = null, token = null }) {
  if (!supabase || !supabaseAdmin) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY não configuradas no servidor.' });
  }
  try {
    const user = await optionalUser(req);
    const ctx = await resolveEventContext({ eventId, token, user });
    if (!ctx || !ctx.decision.canRead) return deniedResponse(res, ctx, { token, user });
    const { data: progressRows, error } = await supabaseAdmin.from('event_progress')
      .select('action, payload').eq('event_id', ctx.event.id).order('created_at', { ascending: true });
    if (error) throw error;
    res.set('Cache-Control', 'no-store');
    res.json(eventResponse(ctx, progressRows));
  } catch (err) {
    logError('Erro ao carregar evento:', err);
    res.status(503).json({ error: 'Não foi possível carregar o evento agora. Tente novamente.' });
  }
}

app.get('/api/events/:id', (req, res) => sendEvent(req, res, { eventId: req.params.id }));
app.get('/api/share/:token', (req, res) => sendEvent(req, res, { token: req.params.token }));

const PROGRESS_ACTIONS = new Set(['status', 'record', 'unrecord', 'mission', 'unmission', 'reset']);
// eventId -> Set<{ res, basis }>. basis 'team' (logado), 'link' ou 'legacy'.
const progressSubscribers = new Map();

function broadcastProgress(eventId, message) {
  const subs = progressSubscribers.get(eventId);
  if (!subs) return;
  const chunk = `data: ${JSON.stringify(message)}\n\n`;
  for (const sub of subs) sub.res.write(chunk);
}

// Mudança de modo, link novo ou link desativado: quem estava conectado pelo
// link (ou pelo endereço antigo) é desconectado na hora e precisa reabrir —
// se o link ainda valer, reconecta; se foi revogado, recebe o aviso.
function closeLinkStreams(eventId) {
  const subs = progressSubscribers.get(eventId);
  if (!subs) return;
  for (const sub of [...subs]) {
    if (sub.basis === 'team') continue;
    sub.res.write(`data: ${JSON.stringify({ action: 'access_changed' })}\n\n`);
    sub.res.end();
    subs.delete(sub);
  }
}

async function handleProgress(req, res, { eventId = null, token = null }) {
  const { action } = req.body || {};
  if (!PROGRESS_ACTIONS.has(action)) {
    return res.status(400).json({ code: 'invalid_payload', error: 'Ação de progresso inválida.' });
  }
  // só grava (e transmite) o que foi reconstruído a partir da lista de campos
  // de cada ação — nunca o corpo cru, que podia ter até 1 MB
  const clean = sanitizeProgressPayload(action, req.body.payload);
  if (!clean.ok) {
    return res.status(400).json({ code: 'invalid_payload', error: clean.error });
  }
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.' });
  }
  try {
    const user = await optionalUser(req);
    const ctx = await resolveEventContext({ eventId, token, user });
    if (!ctx || !ctx.decision.canRead) return deniedResponse(res, ctx, { token, user });
    if (!ctx.decision.canWriteProgress) {
      return res.status(403).json({ code: 'read_only', error: 'Este link só permite visualizar. Peça o link de colaboração a quem organiza o evento.' });
    }
    if (action === 'reset' && !canResetProgress(ctx.role)) {
      return res.status(403).json({ code: 'reset_forbidden', error: 'Só o dono e quem edita o evento podem reiniciar o checklist.' });
    }
    if (!passesLimit(progressEventLimit, ctx.event.id, res)) return;
    if (action === 'reset' && !passesLimit(resetEventLimit, ctx.event.id, res)) return;
    const { error } = await supabaseAdmin.from('event_progress').insert({ event_id: ctx.event.id, action, payload: clean.payload });
    if (error) throw error;
    // reinício apaga o progresso de todos: fica registrado quem fez (o log de
    // progresso em si não guarda autor). O log é append-only, então o que havia
    // antes continua no banco e dá pra recuperar (ver README).
    if (action === 'reset') console.info('Checklist reiniciado: evento', ctx.event.id, 'por', user.id);
    broadcastProgress(ctx.event.id, { action, payload: clean.payload });
    res.json({ ok: true });
  } catch (err) {
    logError('Erro ao salvar progresso:', err);
    res.status(500).json({ error: 'Não consegui salvar o progresso.' });
  }
}

app.post('/api/events/:id/progress', progressRateLimit, (req, res) => handleProgress(req, res, { eventId: req.params.id }));
app.post('/api/share/:token/progress', progressRateLimit, (req, res) => handleProgress(req, res, { token: req.params.token }));

// EventSource não manda cabeçalho de autorização. Quem é da equipe troca o
// login por um ticket curto e usa o ticket na URL do stream — o token de
// sessão nunca vai pra URL.
const streamTickets = new Map(); // ticket -> { eventId, exp }
const STREAM_TICKET_TTL_MS = 60 * 1000;

app.post('/api/events/:id/stream-ticket', requireAuth, async (req, res) => {
  try {
    const ctx = await resolveEventContext({ eventId: req.params.id, user: req.user });
    if (!ctx || !ctx.role) return deniedResponse(res, ctx, { user: req.user });
    const now = Date.now();
    for (const [key, value] of streamTickets) if (value.exp <= now) streamTickets.delete(key);
    const ticket = crypto.randomBytes(24).toString('base64url');
    streamTickets.set(ticket, { eventId: ctx.event.id, exp: now + STREAM_TICKET_TTL_MS });
    res.json({ ticket });
  } catch (err) {
    logError('Erro ao liberar tempo real:', err);
    res.status(503).json({ error: 'Não foi possível conectar o tempo real agora.' });
  }
});

function openStream(req, res, eventId, basis) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write(':ok\n\n');
  if (!progressSubscribers.has(eventId)) progressSubscribers.set(eventId, new Set());
  const sub = { res, basis };
  progressSubscribers.get(eventId).add(sub);
  const heartbeat = setInterval(() => res.write(':hb\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    progressSubscribers.get(eventId)?.delete(sub);
  });
}

app.get('/api/events/:id/stream', async (req, res) => {
  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : null;
  if (ticket) {
    const entry = streamTickets.get(ticket);
    if (!entry || entry.exp <= Date.now() || entry.eventId !== req.params.id) {
      return res.status(401).json({ code: 'ticket_expired', error: 'Conexão em tempo real expirada.' });
    }
    return openStream(req, res, entry.eventId, 'team');
  }
  try {
    const ctx = await resolveEventContext({ eventId: req.params.id });
    if (!ctx || !ctx.decision.canRead) return deniedResponse(res, ctx, {});
    openStream(req, res, ctx.event.id, ctx.decision.basis);
  } catch (err) {
    logError('Erro ao abrir tempo real:', err);
    res.status(503).json({ error: 'Não foi possível conectar o tempo real agora.' });
  }
});

app.get('/api/share/:token/stream', async (req, res) => {
  try {
    const ctx = await resolveEventContext({ token: req.params.token });
    if (!ctx || !ctx.decision.canRead) return deniedResponse(res, ctx, { token: req.params.token });
    openStream(req, res, ctx.event.id, ctx.decision.basis);
  } catch (err) {
    logError('Erro ao abrir tempo real:', err);
    res.status(503).json({ error: 'Não foi possível conectar o tempo real agora.' });
  }
});

function sendIndex(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
}

app.get('/e/:id', sendIndex);
app.get('/e/:id/editar', sendIndex);
app.get('/s/:token', sendIndex);
app.get('/historico', sendIndex);

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
