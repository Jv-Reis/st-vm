# CAPTURA — MVP0 + MVP1 + MVP2

Cole o roteiro de cobertura de um evento (texto livre, sem formato fixo) e o site gera automaticamente um checklist interativo de captação, dividido em fases e cenas — com uma etapa de revisão editável antes de publicar, e um link compartilhável pra equipe.

O progresso de "gravado" é sincronizado em tempo real entre todos os dispositivos que estão vendo o mesmo evento. Publicar exige login (magic link, sem senha) — só quem cria/edita evento precisa de conta; a equipe que só abre o link em campo continua sem login. Dá pra ver o histórico de eventos publicados, editar um evento sem trocar o link, e exportar um relatório de cobertura (imprimir / salvar como PDF) a qualquer momento.

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
5. No dashboard do Supabase, em **Authentication → URL Configuration**, adicione `http://localhost:3000` (e a URL de produção, se tiver) na lista de Redirect URLs — sem isso o login por magic link falha silenciosamente.
6. Suba o servidor:
   ```bash
   npm start
   ```
7. Abra `http://localhost:3000` no navegador.

## Como usar

1. Escreva o roteiro do jeito que quiser — em qualquer editor (Google Docs, Notion, bloco de notas, ChatGPT, o que for) — e copie o texto todo.
2. Cole na caixa de texto da tela inicial. (Ou clique em "Usar roteiro de exemplo" pra testar sem ter um roteiro em mãos.)
3. Clique em "Gerar checklist". A IA organiza o texto em fases, cenas, o que capturar, fala sugerida e regras de pode/não pode.
4. **Revise na prévia**: ajuste título, textos, ícones e formato de qualquer campo; reordene ou remova cenas e fases (setas ↑/↓ e ✕); adicione cena/fase/categoria de missão manualmente; reatribua uma cena pra outra fase pelo seletor "Fase". Preencher **data/hora e local** (ambos opcionais) libera o botão de Google Calendar depois de publicar.
5. Clique em **"Publicar checklist"** — o evento é salvo no banco e você recebe um link (`/e/algumId`) mostrado no topo da página. Copie e mande pra equipe.
6. Use a checklist em campo: marque "Gravar" em cada cena conforme captura, acompanhe o progresso geral e por fase, e marque as "missões" (momentos soltos sem ordem fixa) quando flagrar.
7. Qualquer pessoa que abrir o link do evento carrega o mesmo roteiro direto na checklist (sem precisar colar/gerar de novo).
8. "← Novo roteiro" volta pra tela de importação sem perder o texto colado atual.
9. **"📄 Relatório"** no topo da checklist gera um resumo (cenas capturadas, horários, missões flagradas) pra imprimir ou salvar como PDF — funciona a qualquer momento, evento completo ou não.
10. **"📅 Google Calendar"** aparece ao lado do link do evento se a data foi preenchida — abre o Google Calendar já preenchido (título, data, local, link de volta pro checklist na descrição). Cada pessoa que clicar salva na própria agenda; não é um convite automático nem exige login com Google.

## Login, histórico e edição

- Clique em **"Entrar"** (canto superior direito) e digite seu email — chega um link de acesso, sem senha.
- Publicar um roteiro agora exige login (o rascunho fica salvo esperando você entrar, se tentar publicar deslogado).
- **"Meus eventos"** (`/historico`) lista tudo que você já publicou, com link pra ver ou editar cada um.
- Editar um evento **atualiza o mesmo link** (`/e/:id`) — a equipe que já tem o link não precisa trocar nada.
- Eventos publicados antes dessa mudança continuam funcionando normalmente pra quem só usa o link (ver, marcar "Gravar"), mas não aparecem no histórico de ninguém nem podem ser editados (não têm dono).

## O que NÃO tem ainda

- Login de terceiros (Google, etc.) — só magic link por email.
- Id estável nos itens de missão (só nas cenas) — reordenar/editar itens de missão num evento com progresso já gravado pode desalinhar o que estava marcado. Baixo risco na prática (missões não têm reorder na prévia hoje).
- Limpeza do log `event_progress` — cresce sem limite, ainda não é problema na escala atual de uso.

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
8. Não esqueça de adicionar a URL de produção (ex: `https://captura-checklist.onrender.com`) nos Redirect URLs do Supabase (Authentication → URL Configuration), senão o magic link só funciona em `localhost`.

## Manter o site acordado (Google Apps Script)

✅ Já configurado. O plano free do Render dorme depois de 15 min sem acesso (item 7 acima) — pra evitar que alguém em campo caia bem nesse momento e fique esperando o servidor acordar, um script no Google Apps Script bate na raiz do site a cada 10 minutos, 24h por dia, de graça, usando a conta Google já existente (sem criar cadastro em outro serviço).

**Script** (em [script.google.com](https://script.google.com), projeto próprio):
```javascript
function pingCaptura() {
  UrlFetchApp.fetch('https://captura-checklist.onrender.com/', { muteHttpExceptions: true });
}
```

**Configuração do gatilho:** no projeto do Apps Script → ícone de relógio (Gatilhos) → Adicionar gatilho → função `pingCaptura`, origem "Baseado em tempo", tipo "Timer de minutos", intervalo "A cada 10 minutos". Autorizar o script a fazer requisições externas na primeira execução (prompt normal do próprio Google, é o script pedindo permissão dentro da conta de quem o criou).

Bate só na raiz (`/`) — não consome cota do Gemini nem faz nenhuma escrita no banco, é só o suficiente pra manter o processo do Render vivo.

## Estrutura do projeto

```
server.js              Express: /api/parse-roteiro (Gemini), /api/events (CRUD + histórico, autenticado), /api/config,
                        progresso em tempo real (SSE), rotas /e/:id, /e/:id/editar, /historico
public/index.html      import + prévia editável + login + histórico + checklist + relatório (uma página, alterna via JS)
public/styles.css      estilos (adaptados do protótipo original)
public/app.js          lógica: geração via IA, prévia editável (draft), auth (Supabase), roteamento por URL,
                        publicação/edição, link compartilhável, cards, sincronização de progresso via SSE, relatório
.env.example            modelo de variáveis de ambiente (GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, PORT)
```

**Projeto Supabase:** `captura-checklist` (região sa-east-1 / São Paulo).
- tabela `events` (`id`, `data` jsonb, `owner_id` uuid, `created_at`) — o roteiro publicado. SELECT liberado pra `anon` **e** `authenticated`; INSERT/UPDATE só do dono autenticado (`owner_id = auth.uid()`).
- tabela `event_progress` (`id`, `event_id`, `action`, `payload` jsonb, `created_at`) — log append-only de cada "Gravar"/missão/reset, usado pra persistir e sincronizar o progresso entre dispositivos. Continua público (sem login), de propósito.
- Auth: magic link por email (Supabase Auth), sem senha, sem provider externo.
- **Pegadinha de RLS já corrigida:** a policy de SELECT foi criada só `to anon` no começo — funcionava pra ver a checklist (rota pública), mas quebrava silenciosamente o `PATCH /api/events/:id` pra quem estava logado, porque o `UPDATE ... RETURNING` também precisa de permissão de leitura pra devolver a linha, e usuário autenticado não tinha nenhuma policy de SELECT que valesse pra ele. A policy agora cobre `anon, authenticated`.

## Próximos passos

1. Testar num celular de verdade — a experiência mobile já foi validada por emulação (375×812, overflow, alvos de toque nos botões principais) e alguns problemas foram corrigidos, mas emulação não é 100% igual a testar no aparelho/rede/condições reais de um evento.
2. Convidar a equipe pra usar num evento real e coletar feedback antes de adicionar mais coisa.
3. Google Calendar — hoje é só o link "adicionar à minha agenda" (cada um clica por si). Se sentir falta de convidar a equipe toda de uma vez, dá pra adicionar um campo de emails que pré-preenche os convidados na mesma URL, sem precisar de login com Google.
4. Ideia em aberto: criar o evento (nome + data) antes de ter o roteiro pronto, pra reservar a data com antecedência e só fechar o conteúdo depois.
5. Itens de manutenção: id estável em itens de missão, limpeza do log de progresso.
