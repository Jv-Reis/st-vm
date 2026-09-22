# CAPTURA — briefing pra landing page

> Documento de contexto pra quem for criar a landing page de divulgação do CAPTURA num projeto separado. Não é documentação técnica do código — é sobre o produto, pra quem serve e o que ele faz.

## O que é

CAPTURA é uma ferramenta pra **equipes de cobertura de casamento e eventos** (fotógrafos, videomakers, "storymakers"). Você cola o roteiro de cobertura que já escreveu do seu jeito — texto livre, sem formato fixo, do jeito que sai da sua cabeça — e o site usa IA pra organizar isso automaticamente num **checklist interativo, dividido em fases e cenas**, com um link que a equipe inteira acompanha ao vivo, em campo, no dia do evento.

Não é um editor de roteiro nem um gerador de conteúdo criativo — a IA **organiza**, não **inventa**. Ela não cria falas, piadas ou detalhes que não estavam no texto original; só estrutura o que a pessoa já escreveu em algo que dá pra usar rodando entre convidados, sem precisar ficar rolando um documento longo no celular.

## O problema que resolve

Quem cobre casamento/evento ao vivo hoje geralmente usa: um documento do Google Docs longo, mensagens de WhatsApp soltas, ou decorar tudo. Isso quebra na prática porque:
- **Difícil de consultar rápido em campo** — rolar um documento de texto corrido no meio de uma cerimônia não é viável.
- **Sem visão de progresso da equipe** — quem já gravou a cena X? Alguém perdeu um momento importante? Ninguém sabe até rever o material depois, quando já é tarde.
- **Sem separação de responsabilidade** — vários membros da equipe (cinegrafista, fotógrafo, editor de conteúdo em tempo real pra redes sociais) precisam da mesma informação, mas ninguém tem visão compartilhada de quem fez o quê.
- **Nenhum registro de horário** — depois do evento, saber quanto tempo demorou entre "gravar" e "postar" uma cena (gargalo de edição vs. gargalo de publicação) é só palpite.

## Público-alvo

- **Fotógrafos e videomakers de casamento/evento**, sozinhos ou em equipe pequena/média.
- Quem já escreve roteiro de cobertura (mesmo que informal) e queria algo melhor que "documento + WhatsApp".
- Equipes que fazem **conteúdo ao vivo pra redes sociais durante o evento** (Stories, Reels), não só material editado depois — o produto tem bastante foco em "o que postar agora, em tempo real".
- Não é dirigido a agências grandes/corporativo (embora o exemplo real de um "Evento Corporativo" já tenha sido usado) — o coração do produto é casamento e eventos sociais.

## Como funciona (fluxo do usuário)

1. **Cola o roteiro** — em qualquer editor, texto corrido, sem estrutura. (Tem um roteiro de exemplo pra quem quiser só testar.)
2. **A IA organiza** — separa em fases (ex: Chegada, Cerimônia, Festa) e cenas dentro de cada fase, com: o que capturar, fala/legenda sugerida (se o texto tinha algo assim), o que pode e o que não pode fazer naquela cena, e formato sugerido (Story ao vivo, Reels editado depois, etc.).
3. **Revisão antes de publicar** — tela de prévia editável: ajusta texto, ícone, reordena ou remove cena/fase, adiciona manualmente. Também dá pra preencher data/horário/local (isso já habilita integração com Google Calendar), convidados do Calendar, estrutura de pastas do Google Drive, e adicionar membros da equipe por email.
4. **Publica** — gera um link único e compartilhável (`/e/algumId`). Quem abre o link **não precisa criar conta** — só quem cria/edita o evento precisa de login.
5. **Equipe usa ao vivo, em campo** — cada cena tem 4 estados (**Não iniciado → Em andamento → Feito → Postado**), com horário registrado em cada mudança. O progresso é **sincronizado em tempo real entre todos os dispositivos** — se uma pessoa marca "Feito" no celular dela, todo mundo vê instantaneamente, sem recarregar a página.
6. **"Missões"** — categoria à parte pra momentos soltos, sem ordem fixa, que a equipe deve flagrar a qualquer hora (ex: "alguém chorando de emoção", "um abraço apertado").
7. **Bloco de notas compartilhado** — pra recados da equipe durante a cobertura, também sincronizado ao vivo.
8. **Depois do evento** — gera um relatório (pra imprimir/exportar como PDF) com todas as cenas, horários de cada status, e o tempo entre "Feito" e "Postado" em cada uma — aponta se o gargalo foi editar ou publicar.

## Funcionalidades principais (lista objetiva)

- Geração de checklist via IA a partir de texto livre colado.
- Prévia 100% editável antes de publicar (texto, ícones, ordem, formato de cada campo).
- Link compartilhável — a equipe em campo não precisa de conta.
- Progresso sincronizado em tempo real entre dispositivos (sem precisar atualizar a página).
- 4 estados de progresso por cena, cada um com horário registrado.
- "Missões": momentos soltos sem ordem fixa pra flagrar a qualquer hora.
- Bloco de notas compartilhado, em tempo real.
- Login só pra quem cria/edita (magic link por email ou "Entrar com Google") — equipe de campo usa sem conta.
- Histórico de eventos publicados, com 3 modos de visualização (lista, bloco, calendário).
- Times/permissão: dono do evento, "adicionar membro" por email (convite automático se a pessoa ainda não tem conta), papéis de editor/visualizador por pessoa.
- Integração com Google Calendar: link "adicionar à agenda" pra qualquer um, ou sincronização automática (cria/atualiza evento, convida participantes) pra quem conecta a própria conta Google.
- Integração com Google Drive: cria estrutura de pastas do evento automaticamente (com subpastas aninhadas).
- Relatório pós-evento: cenas capturadas, horários, missões flagradas, tempo de gargalo entre gravar e postar — pronto pra imprimir/exportar em PDF.
- Instalável como app (PWA) — funciona offline em campo, com fila de sincronização que reenvia sozinha quando a conexão volta.

## O que NÃO é (importante pra não prometer demais)

- Não é um editor de vídeo/foto, nem hospeda mídia (fotos, vídeos) — é só organização e checklist.
- Não gera conteúdo criativo (falas, roteiro em si) — só organiza o que a pessoa já escreveu.
- Não é uma ferramenta de gestão de clientes/CRM, nem de contratos/orçamento.
- Hoje é gratuito, sem plano pago — é um produto em fase de validação (ainda não testado num evento real de ponta a ponta, ainda coletando feedback da equipe que já usa).

## Identidade visual atual (do produto/app, pra referência — a landing page não precisa copiar, mas pode se inspirar)

- Nome: **CAPTURA**. Uma marca d'água/logo em formato de flor/obturador de câmera (pétalas amarelas ao redor de um círculo escuro com anel vermelho).
- Tema escuro (fundo quase preto), com **amarelo/âmbar** como cor de destaque principal, verde pra "feito"/sucesso, azul pra "postado", vermelho pra "gravando agora"/urgência.
- Tipografia: um display mais geométrico pra títulos (Space Grotesk), monoespaçada pra labels/metadados (IBM Plex Mono), texto corrido em Inter.
- Tom geral: direto, técnico-mas-acessível, sem gracinha — o produto é uma ferramenta de trabalho pra usar sob pressão em campo, não um produto de consumo casual.

## Estado atual / contexto de negócio

- Produto já em produção, hospedado no Render (free tier), com banco de dados Supabase.
- Uso real hoje: uma pessoa (dona do produto) e uma pequena equipe já testando.
- Ainda não tem modelo de monetização definido — o foco agora é validar com uso real antes de pensar em cobrar.
- A landing page deve funcionar como **página de divulgação/apresentação** — o call-to-action provável é algo como "experimente" / "crie sua conta" / "veja como funciona", não uma compra.
