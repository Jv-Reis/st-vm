# CAPTURA — MVP0 + MVP1

Cole o roteiro de cobertura de um evento (texto livre, sem formato fixo) e o site gera automaticamente um checklist interativo de captação, dividido em fases e cenas — com uma etapa de revisão editável antes de publicar, e um link compartilhável pra equipe.

O progresso de "gravado" é sincronizado em tempo real entre todos os dispositivos que estão vendo o mesmo evento. Ainda sem login nem edição de evento já publicado.

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

- **Login e edição de evento já publicado** (pra editar, é preciso gerar/publicar de novo).
- **Exportação de relatório pós-evento**.

## Deploy no Render (pra o link funcionar fora da sua rede)

✅ Já feito — o projeto está publicado no Render. Passos abaixo ficam de referência caso precise redeployar do zero.

1. **Crie um repositório no GitHub** (github.com → New repository, pode ser privado) e copie a URL dele (ex: `https://github.com/seu-usuario/captura-checklist.git`).
2. **Conecte e suba o código** (rode no terminal, dentro da pasta do projeto):
   ```bash
   git remote add origin https://github.com/SEU-USUARIO/SEU-REPO.git
   ```
   ```bash
   git push -u origin master
   ```
3. **Crie uma conta no Render** em [render.com](https://render.com) (sem cartão de crédito no plano free) e conecte sua conta do GitHub.
4. No painel do Render, clique em **New → Blueprint**, selecione o repositório que você acabou de subir. O Render vai ler o `render.yaml` e configurar o serviço sozinho (nome, comandos de build/start, plano free).
5. Ele vai pedir pra você preencher 3 variáveis de ambiente (não vêm do arquivo por segurança) — copie os mesmos valores do seu `.env` local:
   - `GEMINI_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
6. Clique em **Deploy**. Em alguns minutos o Render te dá uma URL pública (tipo `https://captura-checklist.onrender.com`) — é esse domínio que substitui o `localhost:3000` pra todo mundo da equipe.
7. Lembrete do plano free: se ninguém acessar por 15 minutos, o serviço "dorme" e o próximo acesso demora uns 30-50s pra responder (depois volta ao normal). A IA e o banco não têm esse problema, é só o servidor "acordando".

## Estrutura do projeto

```
server.js              servidor Express + /api/parse-roteiro (Gemini) + /api/events (Supabase) + progresso em tempo real (SSE) + rota /e/:id
public/index.html      tela de importação + prévia editável + tela do checklist (mesma página, alterna via JS)
public/styles.css      estilos (adaptados do protótipo original)
public/app.js          lógica: chamada à API, prévia editável (draft), publicação, link compartilhável, cards, sincronização de progresso via SSE
.env.example            modelo de variáveis de ambiente (GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, PORT)
```

**Projeto Supabase:** `captura-checklist` (região sa-east-1 / São Paulo).
- tabela `events` (`id`, `data` jsonb, `created_at`) — o roteiro publicado.
- tabela `event_progress` (`id`, `event_id`, `action`, `payload` jsonb, `created_at`) — log append-only de cada "Gravar"/missão/reset, usado pra persistir e sincronizar o progresso entre dispositivos.
- RLS habilitado nas duas, com policies públicas de insert/select (sem autenticação de usuário ainda).

## Próximos passos

1. Login, histórico de eventos e edição de evento já publicado.
2. Exportação de relatório pós-evento.
