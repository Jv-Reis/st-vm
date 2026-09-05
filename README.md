# CAPTURA — MVP0 + MVP1 + MVP2

Cole o roteiro de cobertura de um evento (texto livre, sem formato fixo) e o site gera automaticamente um checklist interativo de captação, dividido em fases e cenas — com uma etapa de revisão editável antes de publicar, e um link compartilhável pra equipe.

O progresso de "gravado" é sincronizado em tempo real entre todos os dispositivos que estão vendo o mesmo evento. Publicar exige login (magic link, sem senha) — só quem cria/edita evento precisa de conta; a equipe que só abre o link em campo continua sem login. Dá pra ver o histórico de eventos publicados, editar um evento sem trocar o link, e exportar um relatório de cobertura (imprimir / salvar como PDF) a qualquer momento.

Usa a **API da Anthropic (Claude Sonnet 5)** pra estruturar o roteiro colado em checklist — diferente do Gemini que era usado antes, a Anthropic não tem um plano perpétuo grátis, precisa de créditos pré-pagos em [console.anthropic.com](https://console.anthropic.com/settings/billing), mas o custo por roteiro processado é baixo. O banco é **Supabase (Postgres)**, no plano gratuito ($0/mês) — os eventos publicados persistem de verdade, sobrevivem a restart/redeploy do servidor.

## Como rodar

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Pegue uma chave da Anthropic em [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) (precisa adicionar créditos pré-pagos — não tem plano perpétuo grátis).
3. Copie `.env.example` para `.env`:
   ```bash
   cp .env.example .env
   ```
4. Preencha o `.env` com a chave da Anthropic e as credenciais do projeto Supabase (`SUPABASE_URL` e `SUPABASE_ANON_KEY` — em [supabase.com/dashboard](https://supabase.com/dashboard), aba Settings → API do projeto).
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
4. **Revise na prévia**: ajuste título, textos, ícones e formato de qualquer campo; reordene ou remova cenas e fases (setas ↑/↓ e ✕); adicione cena/fase/categoria de missão manualmente; reatribua uma cena pra outra fase pelo seletor "Fase". Preencher **início, término e local** (todos opcionais) libera o botão de Google Calendar depois de publicar — sem o término preenchido, ou se o término for antes do início, o evento é criado com 4h de duração por padrão (um aviso aparece na prévia se o término preenchido for inválido). Tem também um campo de **"Estrutura de pastas pro Google Drive"**, pré-preenchido com o nome das fases — edite como quiser e clique em "📁 Criar estrutura no Google Drive" (exige ter conectado sua conta do Google, veja a seção própria) pra criar de verdade uma pasta com o nome do evento e as subpastas listadas, na sua conta do Drive. Use `/` numa linha pra aninhar (ex: `Final/Fotos finais` cria "Fotos finais" dentro de "Final") — pastas repetidas em mais de uma linha não duplicam, só reaproveitam a mesma.
5. Clique em **"Publicar checklist"** — o evento é salvo no banco e você recebe um link (`/e/algumId`) mostrado no topo da página. Copie e mande pra equipe.
6. Use a checklist em campo: marque cada cena como **Não iniciado / Em andamento / Feito**, acompanhe o progresso geral e por fase (só "Feito" conta pro percentual), e marque as "missões" (momentos soltos sem ordem fixa) quando flagrar. Cada mudança de status guarda o próprio horário (ex: "Iniciado 14:02 · Concluído 14:15") — útil pra cruzar com o horário dos arquivos na galeria depois. A tela rola livremente (o topo não fica fixo), pra não ocupar espaço da tela em celular.
7. Qualquer pessoa que abrir o link do evento carrega o mesmo roteiro direto na checklist (sem precisar colar/gerar de novo).
8. "← Novo roteiro" volta pra tela de importação sem perder o texto colado atual.
9. **"📄 Relatório"** no topo da checklist gera um resumo (cenas capturadas, horários, missões flagradas) pra imprimir ou salvar como PDF — funciona a qualquer momento, evento completo ou não.
10. **"📅 Google Calendar"** aparece ao lado do link do evento se a data foi preenchida — abre o Google Calendar já preenchido (título, data, local, link de volta pro checklist na descrição). Cada pessoa que clicar salva uma cópia na própria agenda; não exige login com Google. Além disso, em **"Meus eventos"** você pode **"🔗 Conectar Google Calendar"** (uma vez, é uma configuração da conta) — depois de conectado, todo evento seu com data é criado/atualizado automaticamente na sua agenda a cada publicação/edição (edita o mesmo evento, não duplica). Veja a seção própria mais abaixo.

## Login, histórico e edição

- Clique em **"Entrar"** (canto superior direito) e digite seu email — chega um link de acesso, sem senha.
- Publicar um roteiro agora exige login (o rascunho fica salvo esperando você entrar, se tentar publicar deslogado).
- **"Meus eventos"** (`/historico`) lista tudo que você já publicou, com link pra ver ou editar cada um.
- Editar um evento **atualiza o mesmo link** (`/e/:id`) — a equipe que já tem o link não precisa trocar nada.
- Eventos publicados antes dessa mudança continuam funcionando normalmente pra quem só usa o link (ver, marcar "Gravar"), mas não aparecem no histórico de ninguém nem podem ser editados (não têm dono).
- **"Criar evento sem roteiro (reservar a data)"**, na tela inicial, pula direto pra prévia sem gerar nada — dá pra preencher só nome/data/local e publicar (confirma antes, já que não tem cena nenhuma). O evento fica com o link e o Google Calendar funcionando na hora; aparece no histórico como "Rascunho, sem roteiro ainda". Depois, em "Editar" → "← Colar outro roteiro", dá pra colar o texto e gerar as cenas via IA — atualiza o mesmo evento (mesmo link), não cria um novo.
- **"💾 Salvar nos meus eventos"**, na checklist ao vivo, aparece pra quem está logado mas não é dono do evento (quem recebeu o link) — salva o evento no histórico dela também, sem virar dono nem poder editar. Clicar de novo remove. No histórico, esses eventos aparecem marcados como "salvo, não é seu" e sem o botão "Editar".
- **"Meus eventos"** tem 3 modos de visualização (☰ Lista / ▦ Bloco / 📅 Calendário), lembrados entre visitas. No modo Calendário, cada evento aparece no dia da sua data de início; eventos sem data (rascunhos, ou criados manualmente sem data) ficam numa lista separada abaixo.
- **"🔒 Novos membros só veem" / "🔓 Novos membros já editam"**, na checklist ao vivo, aparece só pro dono — controla só o padrão de quem salvar o evento **a partir de agora** (liga = já nasce podendo editar; desliga = só visualiza até o dono promover). Não muda quem já salvou antes.
- **"👥 Gerenciar equipe"**, também só pro dono, lista quem já salvou o evento (email + data) com um seletor por pessoa: **Visualizador** ou **Editor**. É aqui que dá pra promover ou rebaixar alguém individualmente, a qualquer momento — inclusive alguém que salvou antes do interruptor acima existir. No histórico, quem tem "Editor" aparece como "salvo · pode editar" e já vê o botão "Editar".

## O que NÃO tem ainda

- Login de terceiros (Google, etc.) — só magic link por email.
- Id estável nos itens de missão (só nas cenas) — reordenar/editar itens de missão num evento com progresso já gravado pode desalinhar o que estava marcado. Baixo risco na prática (missões não têm reorder na prévia hoje).
- Limpeza do log `event_progress` — cresce sem limite, ainda não é problema na escala atual de uso.
- Editar a estrutura de pastas do Drive depois de criada (adicionar/remover subpasta num evento já publicado) — v1 só cria uma vez; ajustes depois disso são manuais, direto no Drive.
- Convidar a equipe toda de uma vez como convidados do evento no Google Calendar (a integração OAuth de hoje sincroniza só na agenda do dono conectado) — possível evolução futura da integração OAuth, ainda não feita.

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
5. Ele vai pedir pra você preencher as variáveis de ambiente (não vêm do arquivo por segurança) — copie os mesmos valores do seu `.env` local: `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` são obrigatórias; `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `OAUTH_STATE_SECRET` só são necessárias se for usar a sincronização automática com Google Calendar (seção própria mais abaixo) — sem elas o resto do site funciona normal.
6. Clique em **Deploy**. Em alguns minutos o Render te dá uma URL pública (tipo `https://captura-checklist.onrender.com`) — é esse domínio que substitui o `localhost:3000` pra todo mundo da equipe.
7. Lembrete do plano free: se ninguém acessar por 15 minutos, o serviço "dorme" e o próximo acesso demora uns 30-50s pra responder (depois volta ao normal). A IA e o banco não têm esse problema, é só o servidor "acordando".
8. Não esqueça de adicionar a URL de produção (ex: `https://captura-checklist.onrender.com`) nos Redirect URLs do Supabase (Authentication → URL Configuration), senão o magic link só funciona em `localhost`.
9. Serviço já existente (não é um deploy do zero)? Adicione as variáveis novas direto em **Environment** no painel do serviço no Render (não precisa recriar nada) e clique em "Manual Deploy" depois de salvar.

## Manter o site acordado (Google Apps Script)

✅ Já configurado. O plano free do Render dorme depois de 15 min sem acesso (item 7 acima) — pra evitar que alguém em campo caia bem nesse momento e fique esperando o servidor acordar, um script no Google Apps Script bate na raiz do site a cada 10 minutos, 24h por dia, de graça, usando a conta Google já existente (sem criar cadastro em outro serviço).

**Script** (em [script.google.com](https://script.google.com), projeto próprio):
```javascript
function pingCaptura() {
  UrlFetchApp.fetch('https://captura-checklist.onrender.com/', { muteHttpExceptions: true });
}
```

**Configuração do gatilho:** no projeto do Apps Script → ícone de relógio (Gatilhos) → Adicionar gatilho → função `pingCaptura`, origem "Baseado em tempo", tipo "Timer de minutos", intervalo "A cada 10 minutos". Autorizar o script a fazer requisições externas na primeira execução (prompt normal do próprio Google, é o script pedindo permissão dentro da conta de quem o criou).

Bate só na raiz (`/`) — não consome créditos da Anthropic nem faz nenhuma escrita no banco, é só o suficiente pra manter o processo do Render vivo.

## Estrutura do projeto

```
server.js              Express: /api/parse-roteiro (Anthropic/Claude), /api/events (CRUD + histórico, autenticado), /api/config,
                        progresso em tempo real (SSE), rotas /e/:id, /e/:id/editar, /historico
public/index.html      import + prévia editável + login + histórico + checklist + relatório (uma página, alterna via JS)
public/styles.css      estilos (adaptados do protótipo original)
public/app.js          lógica: geração via IA, prévia editável (draft), auth (Supabase), roteamento por URL,
                        publicação/edição, link compartilhável, cards, sincronização de progresso via SSE, relatório
public/manifest.json   manifesto do PWA (nome, ícones, cores) — instalabilidade
public/sw.js           service worker: cache do app shell e do último evento aberto, pra abrir offline
public/icons/          ícones do PWA (gerados a partir da marca já existente, sem arte nova)
.env.example            modelo de variáveis de ambiente (ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, PORT)
```

**Projeto Supabase:** `captura-checklist` (região sa-east-1 / São Paulo).
- tabela `events` (`id`, `data` jsonb, `owner_id` uuid, `created_at`, `allow_member_edit` boolean) — o roteiro publicado. SELECT só pra `authenticated`, dono OU quem tiver linha em `event_members` pra esse evento; UPDATE só pra `authenticated`, dono OU quem tiver linha em `event_members` com `can_edit = true` — **sem policy pra `anon`** em nenhum dos dois. `allow_member_edit` não controla mais autorização direto: é só o valor copiado pro `can_edit` de quem salvar o evento dali pra frente (ver `event_members` abaixo). A rota pública da checklist (`GET /api/events/:id`, sem login) lê com a `SUPABASE_SERVICE_ROLE_KEY` no servidor em vez de depender de RLS aberta; ver nota de segurança abaixo. INSERT só do dono.
- tabela `event_progress` (`id`, `event_id`, `action`, `payload` jsonb, `created_at`) — log append-only de cada mudança de status de cena (`action: 'status'`, com o status e os horários de "em andamento"/"feito")/missão/reset, usado pra persistir e sincronizar o progresso entre dispositivos. Linhas antigas (`action: 'record'/'unrecord'`, de antes do status em 3 níveis) continuam sendo lidas normalmente, como "feito". Continua público (sem login), de propósito.
- tabela `event_members` (`event_id`, `user_id`, `can_edit` boolean, `created_at`) — relação N:N de "eventos salvos por alguém que não é o dono" (botão "💾 Salvar nos meus eventos"), com a permissão de edição daquela pessoa nesse evento específico. Um trigger (`BEFORE INSERT`, `SECURITY DEFINER`) preenche `can_edit` sozinho a partir do `allow_member_edit` do evento no momento do INSERT — o client nunca escolhe esse valor direto (evita repetir o tipo de IDOR já corrigido antes: nunca confiar em payload do client pra decidir autorização). Autenticado só lê/insere/apaga a própria linha (`user_id = auth.uid()`); o **dono do evento** também pode ler e atualizar o `can_edit` de qualquer linha do seu próprio evento (é o que a tela "👥 Gerenciar equipe" usa). Sem policy pra `anon`.
- tabela `google_calendar_accounts` (`user_id`, `google_email`, `refresh_token_enc`, `access_token_enc`, `access_token_expires_at`, `created_at`) — conta Google conectada por quem usa a sincronização automática (Calendar + Drive, uma conexão só). Os tokens ficam **criptografados** (AES-256-GCM, chave só no servidor) antes de salvar — nunca em texto puro no banco. Mesmo padrão de RLS do `event_members`: todo autenticado só lê/insere/apaga a própria linha, sem policy pra `anon`.
- coluna `google_calendar_event_id` em `events` — guarda o ID do evento criado via API do Google Calendar, pra próximas edições **atualizarem** esse evento em vez de criar outro.
- coluna `drive_folder_id` em `events` — guarda o ID da pasta-mãe criada no Google Drive (se a pessoa usou o botão "Criar estrutura no Google Drive" na prévia). A lista de nomes de subpasta em si (editável) fica dentro do `data` jsonb, como `drive_folders`.
- Auth: magic link por email (Supabase Auth), sem senha, sem provider externo.
- **Pegadinha de RLS já corrigida:** a policy de SELECT foi criada só `to anon` no começo — funcionava pra ver a checklist (rota pública), mas quebrava silenciosamente o `PATCH /api/events/:id` pra quem estava logado, porque o `UPDATE ... RETURNING` também precisa de permissão de leitura pra devolver a linha, e usuário autenticado não tinha nenhuma policy de SELECT que valesse pra ele. A policy agora cobre `anon, authenticated`.

## Segurança

Feita uma revisão manual do projeto inteiro (RLS de cada tabela conferida ao vivo no banco, escaping de HTML em todo lugar que renderiza texto do usuário, histórico do Git checado por segredo vazado, `npm audit`). Achados e correções:
- **Limitador de requisições** por IP em `/api/parse-roteiro` (10/15min, protege o gasto na API da Anthropic) e em `/api/events/:id/progress` (120/min — mais generoso porque é uso legítimo normal de uma equipe inteira marcando progresso ao vivo, mas evita inundar a tabela de progresso, que é pública e sem login de propósito).
- `trust proxy` ajustado de `true` pra `1` — confia só no proxy do próprio Render, não deixa o cliente forjar o IP que os limitadores acima enxergam.
- Cabeçalhos básicos de segurança em toda resposta: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
- Tokens do Google, `SUPABASE_SERVICE_ROLE_KEY` e as chaves de criptografia/assinatura nunca chegam ao navegador nem ao Git (`.env` sempre ignorado, conferido no histórico inteiro do repositório).
- **IDOR corrigido (achado por pentest automatizado, 2026-08-29):** a tabela `events` tinha policy de SELECT e UPDATE liberada pra `anon` — como a `SUPABASE_ANON_KEY` é pública por natureza (enviada ao navegador via `/api/config` pro SDK de login), qualquer um podia usá-la direto contra o PostgREST do Supabase (fora do servidor) pra ler a tabela `events` inteira, de todo mundo, e sobrescrever qualquer evento sem estar logado. As policies agora exigem `authenticated` (dono ou membro autorizado); a rota pública `GET /api/events/:id` passou a ler com a `SUPABASE_SERVICE_ROLE_KEY` no servidor, então continua funcionando sem exigir login de quem só recebeu o link, mas sem depender de RLS aberta pra isso. SQL da correção em `supabase-fix-events-rls.sql`.

## Observabilidade (opcional)

Configurando `SENTRY_DSN` (projeto grátis em [sentry.io](https://sentry.io)), todo erro que hoje só ia pro `console.error` (falha chamando a Anthropic, erro salvando/lendo evento no Supabase, falha sincronizando com o Google Calendar) passa a também ser reportado no Sentry — agrupado por tipo, com stack trace, e alerta por e-mail quando aparece um erro novo. Sem essa variável configurada, o app funciona exatamente igual, só sem esse envio extra. Não precisa de mudança nenhuma no código pra ativar, só a variável de ambiente.

## Google Calendar + Drive via OAuth (opcional)

Sem configurar nada, o botão "📅 Google Calendar" (link simples) continua funcionando normalmente. A parte de **"🔗 Conectar Google (Calendar + Drive)"** (sincronização automática do Calendar, que edita em vez de duplicar, + criação de estrutura de pastas no Drive) só liga depois de configurar um projeto no Google Cloud — segue o mesmo espírito do SMTP do Gmail: precisa da sua conta Google, ninguém faz isso por você. É **uma conexão só** cobrindo as duas coisas — não precisa conectar duas vezes.

**1. Criar as credenciais no Google Cloud**
- Acesse [console.cloud.google.com](https://console.cloud.google.com/), crie (ou reaproveite) um projeto, e ative a **Google Calendar API** e a **Google Drive API** (menu "APIs e serviços" → "Biblioteca", uma de cada vez).
- Em "Tela de permissão OAuth": tipo **Externo**, deixe em modo **"Testing"** e adicione os emails da equipe como **testadores** — evita o processo de revisão do Google (só é obrigatório pra apps públicos com muita gente).
- Em "Credenciais" → "Criar credenciais" → **ID do cliente OAuth**, tipo **Aplicativo Web**. Em "URIs de redirecionamento autorizados", adicione:
  - `http://localhost:3000/api/google/oauth/callback` (pra testar local)
  - `https://captura-checklist.onrender.com/api/google/oauth/callback` (produção)
- Copie o **Client ID** e o **Client Secret** gerados.

**2. Variáveis de ambiente**
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SUPABASE_SERVICE_ROLE_KEY=...
TOKEN_ENCRYPTION_KEY=...
OAUTH_STATE_SECRET=...
```
- `SUPABASE_SERVICE_ROLE_KEY`: em Supabase → Project Settings → API — **nunca** é enviada ao navegador (diferente da anon key), só o servidor usa, e só pra duas coisas: salvar a conta conectada no retorno do OAuth (não existe sessão de usuário nesse momento, é um redirect vindo do Google) e ler o token do *dono* do evento na hora de sincronizar, mesmo quando quem editou foi outra pessoa autorizada.
- `TOKEN_ENCRYPTION_KEY` / `OAUTH_STATE_SECRET`: gere cada uma rodando `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — são duas chaves aleatórias separadas, sem relação com nenhuma outra credencial do projeto. **Guarde a `TOKEN_ENCRYPTION_KEY` com cuidado**: se ela for perdida ou trocada, todas as contas Google conectadas precisam se reconectar (os tokens salvos ficam ilegíveis sem ela).

**3. Usar**
Com as variáveis configuradas (local no `.env`, produção nas env vars do Render), o botão "🔗 Conectar Google (Calendar + Drive)" aparece em **"Meus eventos"** (é uma configuração da conta, não de um evento específico — conecta uma vez só). Depois de conectado:
- Publicar/editar qualquer evento seu com data passa a criar/atualizar automaticamente na sua agenda — a mesma edição de antes (que só duplicava) agora atualiza o evento certo.
- Na prévia de qualquer evento, o campo "Estrutura de pastas pro Google Drive" + botão "📁 Criar estrutura no Google Drive" cria de verdade uma pasta com o nome do evento (e as subpastas listadas) no seu Drive — só a estrutura vazia, o site nunca guarda nem envia foto/arquivo nenhum.

Quem já tinha conectado só pro Calendar antes dessa atualização precisa **desconectar e conectar de novo** pra liberar o Drive também (a permissão de Drive só é concedida numa conexão nova).

## PWA (instalar como app)

O CAPTURA agora é instalável — no Chrome (Android/desktop) aparece a opção "Instalar app" ou "Adicionar à tela inicial"; no Safari (iOS), use o menu Compartilhar → "Adicionar à Tela de Início". Uma vez instalado, abre em tela cheia (sem barra do navegador) com ícone próprio.

Também funciona **offline**: depois de abrir um evento pelo menos uma vez com internet, o app shell (HTML/CSS/JS) e os dados daquele evento ficam salvos no cache do navegador — se a conexão cair em campo, dá pra reabrir a checklist já carregada e continuar marcando cena/missão normalmente. Cada marcação sem sinal entra numa fila local (IndexedDB, no próprio navegador) e é reenviada em ordem assim que a conexão volta — a barra de topo mostra um indicador ("N ações sem conexão" em vermelho, "sincronizando N…" em amarelo enquanto reenvia) pra deixar claro que nada foi perdido. Como o iOS Safari não tem a Background Sync API, o reenvio automático acontece quando o app volta a ficar em primeiro plano (reabrir o app/trocar de aba) ou a cada 30s, não em segundo plano com o app fechado — então vale reabrir o CAPTURA rapidinho ao recuperar sinal, em vez de deixar minimizado por horas.

## Próximos passos

1. Testar num celular de verdade — a experiência mobile já foi validada por emulação (375×812, overflow, alvos de toque nos botões principais) e alguns problemas foram corrigidos, mas emulação não é 100% igual a testar no aparelho/rede/condições reais de um evento.
2. Convidar a equipe pra usar num evento real e coletar feedback antes de adicionar mais coisa.
3. Google Calendar — hoje é só o link "adicionar à minha agenda" (cada um clica por si). Se sentir falta de convidar a equipe toda de uma vez, dá pra adicionar um campo de emails que pré-preenche os convidados na mesma URL, sem precisar de login com Google.
4. Itens de manutenção: id estável em itens de missão, limpeza do log de progresso.
