# CAPTURA: Google Calendar e Google Drive

Respostas com base no código atual (`lib/calendar-sync.js`, `server.js` e `public/app.js`).

---

## 1. Calendar: o que é sincronizado?

**A sincronização é só de ida: CAPTURA → Google Calendar.** Nada volta da agenda para a CAPTURA. O app não lê eventos da agenda, não importa datas e não percebe alterações feitas no Google. Se alguém mudar o horário direto no Google Calendar, a CAPTURA não fica sabendo, e a próxima edição do evento na CAPTURA sobrescreve a mudança.

Permissão pedida ao Google: `calendar.events` (criar, editar e apagar eventos). O app só chama criar (`POST`), atualizar (`PATCH`) e apagar (`DELETE`) eventos, sempre na agenda principal (`primary`).

### O que vai para o evento no Google

| Campo no Google | Origem na CAPTURA |
|---|---|
| Título (`summary`) | Nome do evento |
| Início | Data/hora de início |
| Término | Data/hora de término. Se estiver vazio ou for antes do início, usa **início + 4 horas** |
| Local | Local do evento (pode ficar vazio) |
| Descrição | Texto fixo: `Checklist do CAPTURA: <link do evento>` |
| Convidados | Só na cópia do dono: os emails de "Convidados do Google Calendar" |

**O que não vai:** roteiro, fases, cenas, missões, progresso, observações (notas), equipe e pasta do Drive. O roteiro fica só na CAPTURA, e o evento no Google traz apenas o link para abrir o checklist.

Evento **sem data de início não é sincronizado**.

### Quando sincroniza

É automático. A cada criação, edição ou exclusão do evento, e quando muda a equipe ou uma autorização, um gatilho no banco coloca o evento numa fila. O servidor verifica essa fila a cada 15 segundos e, se der erro, tenta de novo depois de 60 segundos.

- **Editar** o evento na CAPTURA atualiza o mesmo evento no Google, sem duplicar.
- **Excluir o evento ou apagar a data** na CAPTURA remove o evento da agenda.

### Na agenda de quem

1. **Dono do evento**: se conectou o Google em "Meus eventos", recebe o evento na própria agenda. Os convidados recebem convite do Google por email.
2. **Membros da equipe**: recebem uma cópia direto na agenda deles, sem convite, mas só se o membro:
   - conectou o próprio Google na CAPTURA, **e**
   - autorizou aquele dono em "Quem pode adicionar eventos à minha agenda".

   Se o membro sair da equipe, a cópia dele é apagada. Se ele revogar a autorização, as próximas mudanças param de chegar, mas o que já está na agenda continua lá.
3. Os **convidados comuns** (campo "Convidados do Google Calendar") recebem o convite padrão do Google. Quem já é membro autorizado é tirado dessa lista, para não receber duas vezes.

### Botão manual "📅 Google Calendar"

Também existe, na tela do evento, um botão que abre o Google Calendar já preenchido (título, datas, local e link na descrição). Ele não precisa de conexão com o Google. A pessoa salva uma cópia por conta própria, e **essa cópia não é atualizada depois**: ela fica fora da sincronização automática.

---

## 2. Drive: só uma pasta ou subpastas também?

**O app cria uma pasta principal por evento e subpastas dentro dela.** Isso não acontece sozinho: a pessoa precisa clicar em **"📁 Criar estrutura no Google Drive"** na tela de criar/editar evento, e precisa ter conectado o Google.

Permissão pedida: `drive.file`. O app só enxerga e mexe no que ele mesmo criou. Nunca lê o resto do Drive e nunca envia arquivos, só cria pastas.

### Nomes

- **Pasta principal**: o **nome do evento** (se estiver vazio: `Evento CAPTURA`). Ela é criada na raiz do "Meu Drive" da pessoa que clicou.
- **Subpastas**: vêm da caixa **"Estrutura de pastas pro Google Drive"**, uma pasta por linha. Os nomes não são fixos:
  - **Padrão:** a caixa já vem preenchida com o **nome de cada fase do roteiro**, na mesma ordem. Exemplo, num casamento com as fases "Making of", "Cerimônia" e "Festa":
    ```
    Casamento Ana e Bruno/
    ├── Making of/
    ├── Cerimônia/
    └── Festa/
    ```
  - **Editável:** a pessoa pode renomear, apagar ou acrescentar linhas antes de criar.
  - **Vários níveis:** uma `/` na linha cria pasta dentro de pasta. `Final/Fotos finais` e `Final/Vídeos finais` criam uma única pasta `Final` com duas subpastas dentro.
  - Evento **sem roteiro** (sem fases) começa com a caixa vazia. Nesse caso, é preciso digitar pelo menos uma pasta.

### Depois de criada

- O ID da pasta principal fica salvo no evento. Aparece o botão **"📁 Abrir pasta no Drive"**, tanto na edição quanto na tela do evento ao vivo.
- O botão passa a ser **"🔄 Adicionar pastas novas ao Drive"**. Ele só acrescenta: reaproveita as pastas que já existem com o mesmo nome e cria só as novas. **Nunca apaga, renomeia nem duplica.** Apagar uma linha da caixa não apaga a pasta no Drive.
- O Drive **não sincroniza**: mudar o nome do evento ou das fases depois não renomeia nada no Drive, e nada do Drive volta para a CAPTURA.
- As pastas ficam no Drive de **quem clicou no botão**. O app não compartilha as pastas com a equipe; isso precisa ser feito pelo próprio Drive.
