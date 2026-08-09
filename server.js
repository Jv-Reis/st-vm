import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

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

app.post('/api/parse-roteiro', async (req, res) => {
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
    const response = await ai.models.generateContent({
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
    res.status(500).json({ error: 'Erro ao chamar a IA (Gemini). Verifique a GEMINI_API_KEY e a conexão.' });
  }
});

app.post('/api/events', async (req, res) => {
  const { event_title, phases, scenes, missions } = req.body || {};

  if (!Array.isArray(scenes) || !scenes.length) {
    return res.status(400).json({ error: 'O evento precisa ter pelo menos uma cena antes de publicar.' });
  }

  if (!supabase) {
    return res.status(500).json({
      error: 'SUPABASE_URL / SUPABASE_ANON_KEY não configuradas no servidor. Copie .env.example para .env e preencha.'
    });
  }

  const id = crypto.randomUUID().split('-')[0];
  const payload = {
    event_title: event_title || 'Evento sem nome',
    phases: phases || [],
    scenes,
    missions: missions || []
  };

  const { error } = await supabase.from('events').insert({ id, data: payload });
  if (error) {
    console.error('Erro ao salvar evento:', error);
    return res.status(500).json({ error: 'Não consegui salvar o evento. Tente de novo.' });
  }
  res.json({ id });
});

app.get('/api/events/:id', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY não configuradas no servidor.' });
  }

  const { data: row, error } = await supabase
    .from('events')
    .select('data')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error || !row) {
    return res.status(404).json({ error: 'Evento não encontrado. O link pode estar errado ou o evento foi removido.' });
  }
  res.json(row.data);
});

app.get('/e/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CAPTURA rodando em http://localhost:${PORT}`);
});
