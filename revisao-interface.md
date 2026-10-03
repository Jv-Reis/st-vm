# Revisão da interface do CAPTURA

Revisão feita com os skills **impeccable** (critique + audit) e **design-taste-frontend**, em 03/10/2026. Duas avaliações independentes: uma de design e outra técnica (detector automático + medições no navegador).

**Notas:** design **24/40** (Aceitável) · técnica **11/20**.

**Limites da revisão:** o navegador não estava logado. O checklist ao vivo e a tela de edição foram vistos com um evento fictício, sem nenhuma gravação. Histórico, equipe, relatório, conflito e tela offline foram avaliados pelo código.

**Decisão já tomada:** direção de tema "escuro + modo campo claro" (tema claro de alto contraste para usar no sol).

**Severidade:** P0 bloqueia o uso · P1 atrapalha muito · P2 incomoda, mas tem contorno · P3 acabamento.

**Não há P0.** Total: 74 itens (8 P1, 35 P2, 31 P3).

---

## Resumo das notas

| # | Heurística (Nielsen) | Nota |
|---|---|---|
| 1 | Visibilidade do estado | 3 |
| 2 | Linguagem do usuário | 3 |
| 3 | Controle e liberdade | 2 |
| 4 | Consistência | 2 |
| 5 | Prevenção de erros | 2 |
| 6 | Reconhecer em vez de lembrar | 3 |
| 7 | Eficiência | 2 |
| 8 | Estética minimalista | 2 |
| 9 | Recuperação de erros | 3 |
| 10 | Ajuda | 2 |
| | **Total** | **24/40** |

| Dimensão técnica | Nota |
|---|---|
| Acessibilidade | 2 |
| Desempenho | 3 |
| Responsivo | 2 |
| Temas | 2 |
| Consistência do código | 2 |
| **Total** | **11/20** |

---

## A. Checklist ao vivo (tela do evento)

| ID | Sev. | Problema | Onde | Sugestão |
|---|---|---|---|---|
| A1 | P1 | No celular (375px), o topo do dono ocupa de 545 a 651px: seis botões em quatro linhas, mais a caixa do link. A primeira cena começa perto de y=800, fora da primeira tela. | `.topbar`, index.html (área do evento) | Topo compacto com título, progresso e sincronização; ações secundárias num menu "Mais". |
| A2 | P1 | O topo não é fixo: progresso, sincronização e navegação por fases somem ao rolar. | `.topbar` | Barra compacta e fixa com progresso e fase atual. |
| A3 | P1 | O controle de status fica no pé de cada card (cards de cerca de 611px). É preciso rolar o card inteiro para marcar. | `cardHTML`, app.js:685 | Status no topo do card; fala sugerida e pode/não pode recolhidos. |
| A4 | P2 | Não existe filtro "só pendentes", "esconder feitos" nem atalho "próxima cena". Com 30 cenas, são cerca de 15 mil px de rolagem. | Tela do evento | Filtro e botão "próxima cena pendente". |
| A5 | P2 | Até 9 ações no topo do dono (Editar, Salvar, Equipe, Observações, Relatório, Reiniciar, Copiar, Calendar, Drive). Passa de 4 opções num ponto de decisão. | Topo do evento | Agrupar: 1 principal, 2 secundárias, o resto em menu. |
| A6 | P2 | "Reiniciar checklist" fica na mesma fileira de "Observações", na área do polegar. | Topo do evento | Mover para o menu "Mais", longe das ações frequentes. |
| A7 | P2 | As Observações (ex.: "sem flash") ficam no fim da página, longe de onde são úteis. | Bloco de notas | Indicador no topo quando houver nota, ou nota fixada acima das cenas. |
| A8 | P2 | Missões não aparecem na navegação de fases. | Navegação de fases | Incluir "Missões" como item da navegação. |
| A9 | P2 | Os 4 botões de status quebram 3+1 em 375px, com alturas de 44 a 55px. "Não iniciado" quebra em duas linhas. | `.status-btn`, styles.css:311 | Grade 2x2 fixa ou rótulos mais curtos. |
| A10 | P2 | O aviso flutuante (toast) fica a 88px do pé e cobre os botões do card. | `#toast`, index.html:473 | Posicionar acima da barra de ação ou no topo. |
| A11 | P3 | O box "Cena 01 / 06" repete a ordem que já está visível. | `cardHTML` | Remover ou reduzir. |
| A12 | P3 | "Formato" usa a cor amarela de prazo (`deadline`), que sugere urgência. | `cardHTML` | Cor neutra. |
| A13 | P3 | O rótulo "Momento do evento" se repete em toda fase. | Cabeçalho de fase | Remover ou trocar por informação útil (horário, contagem). |

## B. Status e cores

| ID | Sev. | Problema | Onde | Sugestão |
|---|---|---|---|---|
| B1 | P1 | O ponto vermelho pulsante (o "gravando" da câmera) marca "Não iniciado". Todo card pendente pisca vermelho o evento inteiro, e o estado que é "gravando agora" ("Em andamento") é amarelo. | `.dot`, styles.css:273; estado ativo em styles.css:313 | "Não iniciado" neutro e parado; pulso só em "Em andamento". |
| B2 | P1 | Voltar para "Não iniciado" apaga os horários de andamento, feito e postado para a equipe toda, sem desfazer. Nenhuma mudança de status tem desfazer. | app.js:2086-2091 | Aviso com "Desfazer" depois de cada mudança; confirmação para voltar. |
| B3 | P2 | "Feito" e "Postado" são botões iguais e colados: fácil errar o toque. | `.status-btn` | Diferenciar visualmente ou usar um botão principal "Marcar como Feito" com menu. |
| B4 | P2 | O botão "Não iniciado" ativo tem contraste 4,38:1 (vermelho sobre fundo suave), abaixo do mínimo WCAG de 4,5:1. É o estado padrão de todos os cards. | styles.css:313 | Escurecer ou trocar a cor do estado. |
| B5 | P2 | A fila offline ("N ações sem conexão") aparece em vermelho de perigo, mas é um estado normal e esperado. | `#syncStatus` | Âmbar ou neutro; vermelho só para falha real. |
| B6 | P2 | A diferença entre "Feito" e "Postado" nunca é explicada. | Botões de status | Dica curta na primeira vez ou legenda na tela. |
| B7 | P3 | O relógio com ponto vermelho pulsante aparece no início e no login, onde nada está "ao vivo". | `.live-dot`, styles.css:191 | Mostrar só na tela do evento. |
| B8 | P3 | Sombra verde brilhante no carimbo "CAPTURADO". | `.captured-stamp` | Remover o brilho. |

## C. Acessibilidade

| ID | Sev. | Problema | Onde | Sugestão |
|---|---|---|---|---|
| C1 | P1 | Os botões de status não dizem qual está selecionado (só a classe `.active` e a cor) nem a qual cena pertencem. O leitor de tela ouve "Feito, botão" dezenas de vezes sem contexto. O mesmo vale para as missões (`.done`) e para os botões de visualização do histórico. WCAG 4.1.2 e 1.4.1. | app.js:722-725, 2043, 1971; index.html:291-293 | Grupo `role="radiogroup"` com `aria-checked` e o nome da cena. |
| C2 | P1 | Sincronização ("N ações sem conexão", "ação não foi salva"), status das observações ("Salvo") e o toast não são anunciados. O toast recebe o texto enquanto está escondido. WCAG 4.1.3. | index.html:383, 440, 473; app.js:1401-1424 | Containers fixos com `role="status"`, trocando só o texto. |
| C3 | P2 | A tela do evento não tem h1 nem h2: o nome do evento é um campo de texto, fases são `div`s, cards são h3. O histórico usa `div` como título e a tela de equipe só tem h3. WCAG 1.3.1 e 2.4.6. | app.js:1942; index.html:280 | Estrutura de títulos h1 > h2 > h3. |
| C4 | P2 | O progresso tem `aria-live="polite"` e anuncia cada atualização dos colegas. | index.html:418 | Anunciar só marcos (ex.: fase concluída) ou tirar o live. |
| C5 | P2 | O modo somente leitura é indicado só por transparência (opacity .55). | `.is-readonly` | Aviso em texto ("Somente visualização") visível no topo. |
| C6 | P3 | Campos de texto perdem o contorno de foco (`outline:none` vence o `:focus-visible`). Só sobra uma borda de 1px. | styles.css:106, 213, 351, 430 | Manter o contorno amarelo também nos campos. |
| C7 | P3 | `conflictPanel.focus()` não funciona (a seção não tem `tabindex`). Os botões de fase rolam a página sem mover o foco. As rolagens suaves ignoram "reduzir movimento". | app.js:2668, 2118-2123, 1124 | `tabindex="-1"`, mover foco, checar `prefers-reduced-motion`. |
| C8 | P3 | Não há link "pular para o conteúdo". O `<main>` só existe na tela do evento, e privacidade.html não tem nenhum landmark. | index.html, privacidade.html | Link de pular e landmarks em todas as telas. |
| C9 | P3 | Os links "Ver / Editar / Excluir" do histórico não dizem de qual evento são. | app.js:1835-1849 | Incluir o nome do evento no nome acessível. |
| C10 | P3 | SVGs da marca sem `aria-hidden`; o "✕" do início depende só de `title`. | index.html | `aria-hidden` e `aria-label`. |
| C11 | P3 | Alguns alvos de toque têm menos de 44px: Copiar 94×38, Calendar e Drive 42px, "Usar exemplo" 42px, checkbox de 16px, botões do calendário com cerca de 13px de altura. | styles.css:219, 393 | Mínimo de 44px. |

## D. Tela de criar/editar evento

| ID | Sev. | Problema | Onde | Sugestão |
|---|---|---|---|---|
| D1 | P2 | Rolagem única com 13 campos antes do roteiro e 74 controles para 3 cenas. Dados do evento, convidados do Calendar, equipe, permissão, compartilhamento e Drive vêm todos misturados. | previewView, index.html | Seções recolhíveis: Evento / Roteiro / Equipe e acesso / Google. |
| D2 | P2 | Rótulos em caixa alta e monoespaçada com até 62 caracteres (o reset de `#previewView` não desfaz o uppercase). | `.field-label`, styles.css:102 e 104; index.html:178, 183, 227 | Rótulos em frase normal, fonte sem serifa. |
| D3 | P2 | O seletor de ícones mostra nomes em inglês ("pin", "cup", "gear"). | app.js:170-172 | Grade visual de ícones. |
| D4 | P2 | Remover cena ou categoria de missão não pede confirmação nem tem desfazer. | app.js:2173-2181 | Desfazer por alguns segundos. |
| D5 | P2 | "Substituir roteiro" fica ao lado de "Salvar". | Topo da prévia | Separar ações destrutivas da principal. |
| D6 | P2 | "Convidados do Google Calendar" vs. "Membros da equipe" precisa de uma dica de três linhas para diferenciar. A dica depende de uma conexão feita em outra tela ("Meus eventos"). | index.html:180, 185 | Agrupar em "Equipe e acesso" com explicação curta e link direto para conectar. |
| D7 | P2 | Duas barras fixas se sobrepõem: a barra de login (z-index 50) cobre os 46px de cima do topo da prévia (z-index 40). Afeta edição, histórico e equipe. | styles.css:50 e 94; app.js:105-106 | Empilhar com `top` calculado ou juntar as barras. |
| D8 | P3 | Cada card de cena na edição tem 3 botões de ícone e 8 campos. | Prévia | Recolher campos avançados. |
| D9 | P3 | Nova categoria de missão vem com o emoji "✨" como padrão. | app.js:590 | Ícone do conjunto SVG. |

## E. Telas de entrada (início, login, acesso negado, erro de abertura)

| ID | Sev. | Problema | Onde | Sugestão |
|---|---|---|---|---|
| E1 | P2 | Todas seguem o mesmo molde genérico: card escuro centralizado com rótulo pequeno acima do título. Não têm identidade do produto. | importView, loginView, accessView, initErrorView | Levar a linguagem de câmera (visor, timecode) para essas telas. |
| E2 | P2 | "Reservar uma data" ao lado de "Gerar checklist" não diz o que faz. | Tela inicial | Rótulo mais claro (ex.: "Criar evento sem roteiro"). |
| E3 | P2 | A tela de login aparece depois de clicar em "Gerar". O texto avisa que o roteiro fica salvo, mas é uma surpresa. | Fluxo de geração | Avisar antes de colar, ou mostrar "Entrar para gerar" no botão. |
| E4 | P3 | "Evento não encontrado" repete o título dentro da mensagem. | accessView | Mensagem com o próximo passo. |
| E5 | P3 | Linha do texto do login com cerca de 95 caracteres (longa demais para ler). | loginView | Largura máxima de 65 caracteres. |
| E6 | P3 | Rótulo "Captura · ..." acima do título em todas as telas de card. | Várias | Reduzir. |
| E7 | P3 | Faixa de fundo visível abaixo do card inicial no celular (`.import-view{min-height:0}`). | styles.css:409 | Corrigir altura mínima. |

## F. Histórico, equipe e Google

| ID | Sev. | Problema | Onde | Sugestão |
|---|---|---|---|---|
| F1 | P2 | O aviso do Google ("app não verificado... clique em não seguro") aparece logo antes de conectar e prejudica a confiança. | index.html:287 | Resolver a verificação do Google; até lá, texto mais tranquilizador. |
| F2 | P2 | Cada card do histórico tem um botão amarelo "Editar". Repetido em todos, o "principal" perde o sentido. | app.js:1835-1849 | Destaque só para a ação mais comum, ou nenhum. |
| F3 | P3 | O formulário "Quem pode adicionar eventos à minha agenda" fica na página do histórico, fora de lugar. | Meus eventos | Mover para uma área de configurações da conta. |
| F4 | P3 | `.calendar-permissions` usa cor `#7775` e raio de 12px, fora do sistema. | styles.css:401 | Usar os tokens. |

## G. Sistema visual e CSS

| ID | Sev. | Problema | Onde | Sugestão |
|---|---|---|---|---|
| G1 | P1 | O app é só escuro (não tem `prefers-color-scheme`), e quem fotografa usa no sol. Bordas a 8% de branco somem na luz forte. | styles.css | Modo campo claro de alto contraste (direção já escolhida). |
| G2 | P2 | Texto abaixo de 11px: botões de status 10,56px, ações do topo 10,88px, rótulos dos cards de 9,92 a 10,24px. Entre 601 e 640px os botões de status caem para 9,92px. | styles.css:188, 198, 210, 250, 286, 295, 303, 311 | Mínimo de 12px; 14px no checklist. |
| G3 | P2 | 41 tamanhos de fonte diferentes, sem escala definida. | styles.css | Escala tipográfica com 6 a 8 tamanhos. |
| G4 | P2 | 18 `alert()` / `confirm()` nativos ao lado de um único diálogo estilizado. | app.js:237, 554, 577, 579, 603, 618, 662, 1035, 1145, 1233, 1245, 1763, 1811, 1823, 2149, 2497, 2630, 2714 | Um componente único de diálogo e aviso. |
| G5 | P2 | Emojis usados como ícones (💾 👥 📝 📄 📅 📁 🔗 🔄 ✨ ⚠️), mesmo com um conjunto de ícones SVG no próprio HTML. | index.html:283, 291-293, 384-389, 403-404; app.js:543-562, 927, 1216-1237 | Só ícones do conjunto SVG. |
| G6 | P2 | Camada de "remendos" no fim do CSS sobrescreve regras anteriores. O bloco de "reduzir movimento" aparece duas vezes, e os breakpoints de 640/600/400px se sobrepõem e deixam um vão entre 601 e 640px. | styles.css:407-491, 366, 447 | Juntar os remendos às regras originais. |
| G7 | P2 | Cores fixas espalhadas: 31 hex e 57 rgba literais. A cor `rgba(18,20,28,...)` do topo é azulada e não está na paleta. | styles.css | Tudo via tokens. |
| G8 | P3 | Raios de borda variados: 999, 18, 16, 12, 10, 9, 8 e 4px. | styles.css | Uma regra (ex.: botões em pílula, cards 16, campos 10). |
| G9 | P3 | Links com cara de botão continuam sublinhados ("Editar evento", "Google Calendar", "Pasta no Drive", "Ver"/"Editar" do histórico, voltar da privacidade). São 9 classes de botão diferentes. | styles.css, `a{}` | Unificar variantes de botão. |
| G10 | P3 | 9 atributos `style=` no HTML e 4 nos templates do app.js. | index.html, app.js | Classes no CSS. |
| G11 | P3 | Textos longos (dicas, rótulos de botão) em fonte monoespaçada, difíceis de ler. | styles.css | Mono só para horários e códigos. |
| G12 | P3 | Bordas de botões secundários com contraste de cerca de 1,9:1 e bordas de campo com 1,41:1. | styles.css | Bordas mais visíveis (ajuda também no modo campo). |
| G13 | P3 | Animação com efeito de quique no banner de conclusão; a barra de progresso anima a largura. | styles.css:356, 227 | Easing suave; animar `transform`. |

## H. Textos

| ID | Sev. | Problema | Onde | Sugestão |
|---|---|---|---|---|
| H1 | P3 | 37 travessões (—) no texto do app (index.html + app.js, incluindo o título da aba e a linha "3 fases — roteiro gerado...") e 12 na política de privacidade. | index.html, app.js:284, 949, 968, 1955, 2951; privacidade.html | Trocar por ponto, vírgula ou dois-pontos. |
| H2 | P3 | Alguns alertas mostram a mensagem técnica do erro (`err.message`). | app.js (alertas) | Mensagens fixas com o próximo passo. |
| H3 | P3 | A frase "roteiro gerado a partir do texto colado" aparece no subtítulo e no rodapé. | eventSub e rodapé | Manter uma só. |
| H4 | P3 | "Missões" nunca são explicadas para quem usa pela primeira vez. | Bloco de missões | Uma linha de explicação. |

## I. Desempenho e offline

| ID | Sev. | Problema | Onde | Sugestão |
|---|---|---|---|---|
| I1 | P2 | A animação do ponto pulsante roda sem parar em todo card pendente e redesenha a cada quadro, gastando bateria em campo. (Desliga com "reduzir movimento".) | styles.css:273 | Resolvido junto com B1. |
| I2 | P2 | As fontes do Google (3 famílias, 10 pesos) não entram no cache do service worker; offline, o app abre com fontes do sistema. | index.html; sw.js:139 | Hospedar as fontes no próprio app. |
| I3 | P3 | `backdrop-filter` no topo (que nem é fixo) e nos seis botões de ação. | styles.css:182, 198 | Remover onde não há nada atrás. |
| I4 | P3 | `app.js` (142 KB) e `supabase.js` (211 KB) vão sem minificação. | public/ | Minificar no deploy. |

## J. Relatório impresso

| ID | Sev. | Problema | Onde | Sugestão |
|---|---|---|---|---|
| J1 | P2 | Cinzas abaixo do contraste mínimo no papel: `.report-muted #888` (3,54:1) nos horários e `.report-footer #999` (2,85:1). | styles.css:172, 174 | Cinzas mais escuros (#666 ou abaixo). |

---

## O que está bom (manter)

- Estados de falha bem desenhados: conflito de edição, abertura offline com lista de eventos salvos, telas distintas para link revogado, evento inexistente e acesso só da equipe.
- Modelo de status com 4 estados, carimbo e horário; o horário do toque é preservado offline.
- Marcar uma cena atualiza só aquele card, sem redesenhar a lista.
- Identidade de câmera nos cards: cantos de visor, carimbo "CAPTURADO 15:05", horários em fonte de timecode, quadros "Pode / Não pode".
- A maioria dos alvos de toque tem 44px ou mais; respeita "reduzir movimento"; nada transborda para os lados em 375, 620 e 1024px nem com o texto em 200%.
- Contraste do texto principal de 18:1; campos com 16px no celular (evita o zoom do iOS).
- Diálogo de reiniciar com `<dialog>` nativo, foco no "Cancelar" e desfazer.
- Fim da jornada forte: banner ao chegar em 100% e relatório limpo para imprimir.

## Sobre o detector automático

Acusou 80 itens; 55 são falsos positivos:
- **Contraste:** calculou sobre fundo branco em vez do fundo escuro real. A verificação no navegador encontrou zero problemas nesses pontos.
- **Bordas laterais:** confundiu os cantos de visor dos cards (styles.css:260-261) com bordas decorativas.

Os achados reais do detector estão incluídos nas tabelas acima (D2, G2, B1/I1, G13, H1).

## Perguntas para pensar

- Se em campo a pessoa só precisa de "o que é agora, o que vem depois, marcar", a tela ao vivo deveria ser uma folha de chamada guiada pelo horário do evento, em vez de um arquivo de todas as cenas com o briefing completo?
- E se o vermelho pulsasse só quando algo está de fato sendo gravado?
- Quem planeja na mesa e quem fotografa no evento precisam da mesma densidade de informação?
