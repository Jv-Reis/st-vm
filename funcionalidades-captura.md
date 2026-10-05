# CAPTURA: funcionalidades e o que cada uma usa

Referência para conferir a landing page. Descreve o que o app faz **hoje**, conferido no código (versão `659164d`, 05/10/2026). Se a landing promete algo que não está aqui, ou que está na lista "O que o CAPTURA não faz", precisa ser corrigido.

---

## Em uma frase

Quem cuida da cobertura de um evento (storymaker, filmmaker, fotógrafo, cerimonialista) cola o roteiro em texto livre, a IA organiza em um checklist de fases e cenas, e a equipe usa esse checklist ao vivo no celular, sincronizado em tempo real e funcionando mesmo sem internet.

- **Público:** equipes de foto, vídeo e redes sociais em casamentos, 15 anos, aniversários e eventos corporativos.
- **Idioma:** só português (Brasil).
- **Onde roda:** no navegador (celular ou computador). Pode ser instalado como app na tela inicial (PWA). Não existe app nas lojas (App Store / Google Play).
- **Preço:** hoje é gratuito, com limites de uso justo (ver "Limites"). Não existe plano pago nem cobrança dentro do app.

---

## Tecnologias e serviços usados

| Serviço / tecnologia | Para quê |
|---|---|
| **Anthropic Claude** (modelo `claude-haiku-4-5`) | Transformar o roteiro colado em fases, cenas e missões |
| **Supabase** (Postgres + Auth) | Banco de dados, login (link mágico por email e Google) e envio dos emails de login e de convite |
| **Google Calendar API** | Criar e atualizar o evento na agenda (opcional) |
| **Google Drive API** | Criar pastas do evento no Drive (opcional) |
| **Render** | Hospedagem do site e do servidor |
| **Sentry** | Registro de erros técnicos do servidor |
| **Node.js + Express** | Servidor |
| **HTML, CSS e JavaScript puros** | Interface (sem React/Vue) |
| **Service worker + IndexedDB** | Funcionar offline e guardar marcações feitas sem internet |
| **Server-Sent Events (SSE)** | Atualização em tempo real entre a equipe |

---

## 1. Criar o checklist

### Colar o roteiro e gerar com IA
- **Entrada:** cola-se o roteiro em qualquer formato: texto do WhatsApp, Google Docs, Notion, ChatGPT, bloco de notas. Não há modelo fixo para seguir.
- **Saída:** a IA organiza o texto em:
  - **fases**, na ordem do evento (ex.: Making of, Cerimônia, Festa);
  - **cenas** dentro de cada fase, cada uma com título, ícone, formato (ex.: "Story ao vivo", "Reels"), lista do que capturar, fala sugerida e o que **pode** e **não pode** fazer;
  - **missões**: momentos soltos, sem hora certa, para flagrar a qualquer momento (ex.: "alguém chorando de emoção"). Só aparecem se o roteiro mencionar algo assim.
- **Regra da IA:** ela **organiza, não inventa**. Se o roteiro não tem fala sugerida, o campo fica vazio; ela não cria conteúdo criativo.
- **Login:** gerar exige estar logado. Se a pessoa não estiver, o texto colado fica guardado e a geração continua sozinha depois do login.
- **Roteiro de exemplo:** há um botão "Usar exemplo" para testar sem ter um roteiro em mãos.
- **Usa:** Anthropic Claude (no servidor).

### Reservar uma data (evento sem roteiro)
- **Sem IA:** cria o evento só com nome, data e local.
- **Roteiro depois:** em "Editar" → "Adicionar roteiro", cola-se o texto e a IA gera as cenas no **mesmo** evento (mesmo link).

---

## 2. Revisar e editar antes de publicar

A tela de criar/editar tem 4 seções recolhíveis:

- **Evento:** nome, início, término, local e observações para a equipe.
  - Avisa quando o término é antes do início.
- **Roteiro:** edição de fases, cenas e missões.
  - Mudar textos, reordenar (↑ ↓), remover, adicionar à mão, trocar uma cena de fase.
  - Os ícones são escolhidos numa grade visual, com nomes em português.
  - As cenas aparecem recolhidas, para revisar rápido.
- **Equipe e acesso:** membros por email, permissão padrão dos novos membros e quem pode abrir o evento (ver seção 3).
- **Google:** convidados do Google Calendar e estrutura de pastas do Drive.

**Também:**
- **Substituir roteiro:** num evento já publicado, troca as cenas mantendo nome, datas, equipe, link e pasta do Drive. O progresso antigo não é transferido para as cenas novas, e o app avisa antes.
- **Edição simultânea:** se outra pessoa salvou o evento enquanto você editava, o app **não sobrescreve**. Ele mostra "Este evento foi alterado por outra pessoa", e você pode comparar as versões, copiar seu rascunho ou carregar a versão mais recente.

---

## 3. Publicar e compartilhar com a equipe

### Link do evento e modos de acesso
O dono escolhe, por evento, quem pode abrir:

| Modo | Quem abre | Quem marca progresso |
|---|---|---|
| **Somente equipe** | dono e membros, com conta | dono e membros |
| **Link para visualizar** | qualquer pessoa com o link | só dono e membros |
| **Link para colaborar** (padrão) | qualquer pessoa com o link, **sem precisar de conta** | qualquer pessoa com o link |

- **Link com código:** o link público usa um código aleatório (`/s/...`), não o ID do evento.
- **Gerar novo ou desativar:** o dono pode fazer isso a qualquer momento. O link antigo **para de funcionar na hora**, inclusive para quem estiver com ele aberto.
- **Privacidade:** quem entra só pelo link **não vê** os emails da equipe nem dos convidados.
- **Usa:** Supabase (banco e regras de acesso).

### Equipe e convites
- **Adicionar membros:** o dono adiciona membros pelo email.
  - Quem já tem conta entra na hora.
  - Quem não tem recebe um **convite por email**.
- **Resumo depois de salvar:** quem foi adicionado, convites enviados, quem já estava, emails inválidos e falhas.
  - Falhas temporárias são tentadas de novo automaticamente.
  - O dono pode **reenviar só os convites que falharam**.
- **Papéis:** cada membro é **Visualizador** ou **Editor**, ajustável por pessoa em "Gerenciar equipe".
  - O dono escolhe se novos membros já entram como editores.
- **Salvar nos meus eventos:** quem está logado e abriu um link de colaboração pode adicionar o evento à própria lista.
- **Usa:** Supabase Auth (emails de convite) e fila de convites no banco.

---

## 4. Usar em campo (checklist ao vivo)

Tela pensada para celular, uma mão e pressa:
- **Topo fixo:** nome do evento, progresso (ex.: "7/20 cenas · 35%"), sincronização e as fases. A fase em que você está acende sozinha.
- **Status de cada cena:** **Não iniciado / Em andamento / Feito / Postado**, no topo de cada card.
  - "Feito" e "Postado" contam como capturada no progresso.
  - Cada mudança guarda **data e hora** (ex.: "Iniciado 10/10 14:02 · Concluído 14:15 · Postado 14:38").
- **No card:** a lista do que capturar fica sempre visível. A fala sugerida e o pode/não pode ficam recolhidos em "Fala e regras".
- **Só pendentes:** esconde as cenas já capturadas. A escolha é lembrada no aparelho.
- **Próxima:** botão fixo embaixo que leva à próxima cena pendente.
- **Missões:** chips para marcar quando flagrar.
- **Observações:** bloco de notas compartilhado com a equipe em tempo real.
  - Uma prévia aparece no começo da tela.
  - Só dono e editores escrevem.
- **Menu "Mais":** link do evento, Google Calendar, pasta do Drive, relatório, editar evento, gerenciar equipe e reiniciar checklist.
- **Reiniciar checklist:**
  - Só dono e editores, no máximo 3 vezes por hora.
  - Pede confirmação e oferece **Desfazer**.
  - Avisa a equipe.
- **Somente visualização:** com o link de visualizar, os botões ficam bloqueados.

### Tempo real
O que um membro marca aparece na hora na tela dos outros.
- **Usa:** Server-Sent Events.

### Offline
Funciona **sem internet** para eventos já abertos uma vez com internet naquele aparelho.
- **Fila sem conexão:** as marcações feitas offline ficam numa fila no próprio celular e são enviadas em ordem quando a conexão volta.
- **Indicador:** o topo mostra "N ações sem conexão" e depois "sincronizando…".
- **Horário:** o que vale é o do toque, não o da sincronização.
- **Sem conexão na abertura:** o app mostra os eventos disponíveis offline em vez de travar em "Carregando…".
- **iPhone (Safari):** o reenvio acontece ao voltar para o app ou a cada 30 segundos, não com o app fechado.
- **Primeiro acesso:** precisa de internet.
- **Usa:** service worker e IndexedDB.

---

## 5. Depois do evento: relatório
- **Conteúdo:** cenas capturadas (com %), quantas já foram postadas, missões flagradas e uma tabela por fase com status, horários e **demora entre "Feito" e "Postado"**. A demora é calculada mesmo de um dia para outro.
- **Exportar:** botão **Imprimir / Salvar PDF**, pelo próprio navegador.
- **Quando:** pode ser gerado a qualquer momento, com o evento completo ou não.

---

## 6. Meus eventos (histórico)
- **O que lista:** os eventos que você criou e os que salvou de outras pessoas, marcados como "salvo, não é seu".
- **3 visualizações:** Lista, Bloco e **Calendário** (cada evento no dia de início). A escolha é lembrada.
- **Ações:**
  - Ver.
  - Editar: dono e editores.
  - Excluir: só o dono, e apaga o evento de verdade.
  - Remover: tira da sua lista um evento salvo de outra pessoa.

---

## 7. Integrações com o Google (opcionais)

Conecta-se uma vez em "Meus eventos". Permissões pedidas: `calendar.events` e `drive.file`. O `drive.file` só dá acesso ao que o próprio CAPTURA cria.

### Google Calendar
- **Botão manual "Adicionar ao Google Calendar":** abre a agenda já preenchida com título, data, local e link do checklist. **Não precisa conectar o Google.** A cópia salva assim não é atualizada depois.
- **Sincronização automática (com o Google conectado):**
  - **O que faz:** cada evento com data é criado e atualizado na agenda do dono. Editar no CAPTURA atualiza o mesmo evento, e excluir ou tirar a data remove da agenda.
  - **Convidados:** os emails em "Convidados do Google Calendar" recebem convite do Google.
  - **Membros da equipe:** recebem o evento direto na agenda deles, sem convite, se conectaram o Google e autorizaram aquele organizador.
- **Sentido único: só do CAPTURA para a agenda.** Nada volta da agenda para o CAPTURA.
- **O que vai para a agenda:** título, início, término (4h por padrão se não houver), local e o link do checklist. O roteiro **não** vai.

### Google Drive
- **Botão "Criar estrutura no Google Drive":** cria uma pasta com o nome do evento e subpastas. O padrão é uma subpasta por fase, editável, e `/` cria pasta dentro de pasta.
- **Depois de criada:** dá para **adicionar** pastas novas; nada é apagado nem duplicado.
- **O que não faz:** só cria pastas. **Não envia nem lê arquivos**, e não compartilha as pastas com a equipe automaticamente.

---

## 8. Conta e login
- **Formas de entrar:**
  - **Entrar com Google**;
  - **link mágico por email**, sem senha.
- **Quem precisa de conta:** quem cria ou edita.
- **Quem não precisa:** quem só usa um link de colaborar ou de visualizar.
- **Usa:** Supabase Auth.

---

## 9. App instalável (PWA)
- **Como instalar:**
  - **Chrome:** "Instalar app" / "Adicionar à tela inicial".
  - **Safari no iPhone:** Compartilhar → "Adicionar à Tela de Início".
- **Instalado:** abre em tela cheia, com ícone próprio.
- **Atualização:** automática ao abrir, sem loja.

---

## 10. Segurança e privacidade
- **Regras no banco (RLS):** cada evento só é lido ou editado por quem tem permissão.
- **Progresso:** só passa pelo servidor, que confere o modo de acesso.
- **Tokens do Google:** guardados criptografados (AES-256-GCM).
- **Rastro de quem marcou:** o app **não registra quem marcou cada cena** (nem nome, nem conta, nem aparelho); guarda só o status e o horário.
- **Dados:** não são vendidos nem usados para publicidade.
- **Política de privacidade:** em `/privacidade.html`.
- **Ao sair da conta:** as cópias offline dos eventos são apagadas do aparelho.

---

## Limites (uso justo)
- **Gerar com IA:** 3 por conta a cada 15 minutos, e 10 por IP a cada 15 minutos.
- **Adicionar membros:** 20 por conta por hora.
- **Reiniciar checklist:** 3 vezes por hora por evento.
- **Tamanho dos textos:**
  - Nome do evento: até 70 caracteres.
  - Local: até 120 caracteres.
  - Observações: até 20.000 caracteres.

---

## O que o CAPTURA **não** faz

Se a landing disser algo disto, está errado:

- **Sem app nas lojas:** não é app nativo e não está na App Store nem na Google Play. É um site instalável (PWA).
- **Sem cobrança:** não tem plano pago, assinatura nem pagamento.
- **Agenda só de ida:** não importa nem lê eventos do Google Calendar.
- **Drive só cria pastas:** não envia, não guarda e não organiza fotos ou vídeos.
- **Sem armazenamento de mídia:** não edita nem armazena fotos ou vídeos.
- **Sem autoria das marcações:** não registra quem marcou cada cena.
- **Observações sem histórico:** não guardam versões; vale a última salva.
- **Sem lista de convidados:** não tem RSVP nem gestão de convidados do evento. "Convidados do Google Calendar" são só os convites da agenda.
- **Sem notificações push:** não envia notificações para o celular nem lembretes.
- **Sem chat:** não tem chat da equipe; o mais próximo é o bloco de Observações compartilhado.
- **IA não inventa:** a IA não cria roteiro do zero nem inventa conteúdo; só organiza o texto colado.
- **Só português (Brasil):** sem outros idiomas.
- **Sem tema claro:** a interface é só escura.
- **Offline com limite:** só funciona offline em eventos abertos antes com internet naquele aparelho, e o primeiro acesso precisa de internet.

---

## Pontos de atenção para a landing

- **Google não verificado:** o app do Google ainda não tem a verificação completa de marca. Ao conectar, o Google pode mostrar a tela de "app não verificado". Evite dizer "verificado pelo Google".
- **"Grátis":** só é correto enquanto não houver plano pago. Evite "grátis para sempre" ou "ilimitado", porque existem os limites acima.
- **"Funciona offline":** é verdade com a ressalva de ter aberto o evento antes com internet.
- **"Tempo real":** é verdade para status, missões e observações entre quem está com o evento aberto.
- **"Sem conta para a equipe":** é verdade só no modo **Link para colaborar** ou **Link para visualizar**. No modo **Somente equipe**, todos precisam de conta.
