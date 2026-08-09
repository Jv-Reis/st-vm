# CAPTURA — MVP0 + MVP1

Cole o roteiro de cobertura de um evento (texto livre, sem formato fixo) e o site gera automaticamente um checklist interativo de captação, dividido em fases e cenas — com uma etapa de revisão editável antes de publicar, e um link compartilhável pra equipe.

Ainda sem login, sem tempo real entre dispositivos (cada pessoa que abre o link vê o roteiro, mas o progresso de "gravado" é local a cada aba/dispositivo).

Usa a **API do Gemini (Google)** no plano gratuito — não precisa de cartão de crédito nem gastar nada dentro da cota gratuita (10 requisições/min, ~250-500/dia, mais do que suficiente pra uso de uma equipe pequena). O banco é **Supabase (Postgres)**, também no plano gratuito ($0/mês) — os eventos publicados persistem de verdade, sobrevivem a restart/redeploy do servidor.

## Como rodar

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Pegue uma chave grátis do Gemini em [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (login com conta Google, sem cartão de crédito).
3. Copie `.env.example` para `.env`:
   ```bash
   cp .env.example .env
   ```
4. Preencha o `.env` com a chave do Gemini e as credenciais do projeto Supabase (`SUPABASE_URL` e `SUPABASE_ANON_KEY` — em [supabase.com/dashboard](https://supabase.com/dashboard), aba Settings → API do projeto).
5. Suba o servidor:
   ```bash
   npm start
   ```
6. Abra `http://localhost:3000` no navegador.

## Como usar

1. Escreva o roteiro do jeito que quiser — em qualquer editor (Google Docs, Notion, bloco de notas, ChatGPT, o que for) — e copie o texto todo.
2. Cole na caixa de texto da tela inicial. (Ou clique em "Usar roteiro de exemplo" pra testar sem ter um roteiro em mãos.)
3. Clique em "Gerar checklist". A IA organiza o texto em fases, cenas, o que capturar, fala sugerida e regras de pode/não pode.
4. **Revise na prévia**: ajuste título, textos, ícones e formato de qualquer campo; reordene ou remova cenas e fases (setas ↑/↓ e ✕); adicione cena/fase/categoria de missão manualmente; reatribua uma cena pra outra fase pelo seletor "Fase".
5. Clique em **"Publicar checklist"** — o evento é salvo no banco e você recebe um link (`/e/algumId`) mostrado no topo da página. Copie e mande pra equipe.
6. Use a checklist em campo: marque "Gravar" em cada cena conforme captura, acompanhe o progresso geral e por fase, e marque as "missões" (momentos soltos sem ordem fixa) quando flagrar.
7. Qualquer pessoa que abrir o link do evento carrega o mesmo roteiro direto na checklist (sem precisar colar/gerar de novo).
8. "← Novo roteiro" volta pra tela de importação sem perder o texto colado atual.

## O que NÃO tem ainda

- **Tempo real entre dispositivos**: cada pessoa que abre o link vê o roteiro publicado, mas marcar "Gravar" é local àquela aba — a equipe não vê o progresso uma da outra em tempo real.
- **Link funcional fora da sua rede**: o link (`http://localhost:3000/e/...`) só abre em quem tiver acesso a essa máquina/rede. O banco (Supabase) já é externo e persistente, então falta só hospedar o site em algum lugar público (ex: Render free tier) — isso ainda não foi feito.
- **Login e edição de evento já publicado** (pra editar, é preciso gerar/publicar de novo).

## Estrutura do projeto

```
server.js              servidor Express + /api/parse-roteiro (Gemini) + /api/events (Supabase) + rota /e/:id
public/index.html      tela de importação + prévia editável + tela do checklist (mesma página, alterna via JS)
public/styles.css      estilos (adaptados do protótipo original)
public/app.js          lógica: chamada à API, prévia editável (draft), publicação, link compartilhável, cards
.env.example            modelo de variáveis de ambiente (GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, PORT)
```

**Projeto Supabase:** `captura-checklist` (região sa-east-1 / São Paulo), tabela `events` (`id`, `data` jsonb, `created_at`), RLS habilitado com policies públicas de insert/select (sem autenticação de usuário ainda).

## Próximos passos

1. Hospedar o site publicamente (ex: Render free tier) pra o link compartilhável funcionar fora da sua rede — o banco já está pronto pra isso.
2. Sincronização em tempo real entre dispositivos da equipe em campo (o Supabase já suporta isso nativamente via Realtime).
3. Login, histórico de eventos e edição de evento já publicado.
4. Exportação de relatório pós-evento.
