import { mergeGeneratedRoteiro, hasRoteiro } from './roteiro-draft.js';
import { diffEventDrafts, draftToText } from './event-diff.js';
import { nowStamp, formatStamp, formatStampFull, formatDelay, isLegacyStamp } from './progress-time.js';
import { isPendingStatus, countPending, nextPendingId } from './checklist-nav.js';

if('serviceWorker' in navigator){
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

(function(){
  const ICONS = ['pin', 'gear', 'mic', 'play', 'users', 'cup', 'chat', 'flag', 'film', 'box', 'signal', 'heart'];
  const ICON_LABELS = {
    pin: 'Local', gear: 'Equipamento', mic: 'Microfone', play: 'Vídeo', users: 'Pessoas', cup: 'Brinde',
    chat: 'Conversa', flag: 'Marco', film: 'Filme', box: 'Detalhes', signal: 'Transmissão', heart: 'Momento especial'
  };

  const EXAMPLE_ROTEIRO = `Evento: Ana & Bruno, Espaço Villa Verde, casamento com cerimônia e festa.

Chegada: mostrar a noiva chegando no espaço, descendo do carro, ajeitando o vestido, reação da equipe. Se ela soltar alguma piada nervosa, aproveita. Frase pra usar: "Gente, já são 14h e eu ainda nem me arrumei direito" rs. Pode captar a correria real dela. Não pode pedir pra repetir a entrada. Formato: story ao vivo.

Making of do salão: salão ainda vazio, decoração sendo montada, flores chegando, mesas sendo arrumadas. Importante repetir o mesmo ângulo que vai ser usado depois pra fazer o comparativo antes/depois. Formato: story.

Cerimônia: entrada da noiva, trocas de aliança, votos, choro dos pais, aplausos no beijo. Aqui não precisa de texto em cima, deixa a emoção falar sozinha. Formato: reels editado depois.

Festa: mostrar a decoração pronta (mesmo ângulo do salão vazio), pista lotada, primeira dança, brinde. Intercalar com bastidor: noivos cansados, equipe resolvendo pepino de última hora. Formato: reels.

Também dá pra flagrar a qualquer momento, sem hora certa: alguém chorando de emoção, um abraço apertado, a noiva rindo à toa, e a transformação do salão vazio pro salão pronto.`;

  const loadingView = document.getElementById('loadingView');
  const importView = document.getElementById('importView');
  const previewView = document.getElementById('previewView');
  const appView = document.getElementById('appView');
  const loginView = document.getElementById('loginView');
  const historyView = document.getElementById('historyView');
  const accountView = document.getElementById('accountView');
  const roteiroInput = document.getElementById('roteiroInput');
  const generateBtn = document.getElementById('generateBtn');
  const exampleBtn = document.getElementById('exampleBtn');
  const quickCreateBtn = document.getElementById('quickCreateBtn');
  const importError = document.getElementById('importError');
  const heroIntro = document.getElementById('heroIntro');
  const heroDismissBtn = document.getElementById('heroDismissBtn');
  const previewPhasesContainer = document.getElementById('previewPhasesContainer');
  const previewMissionsContainer = document.getElementById('previewMissionsContainer');
  const googleLoginBtn = document.getElementById('googleLoginBtn');
  const loginEmailInput = document.getElementById('loginEmailInput');
  const loginSubmitBtn = document.getElementById('loginSubmitBtn');
  const loginBackBtn = document.getElementById('loginBackBtn');
  const loginStatus = document.getElementById('loginStatus');
  const authStrip = document.getElementById('authStrip');
  const authStripLoggedOut = document.getElementById('authStripLoggedOut');
  const authStripLoggedIn = document.getElementById('authStripLoggedIn');
  const authStripEmail = document.getElementById('authStripEmail');
  const authStripLoginBtn = document.getElementById('authStripLoginBtn');
  const authStripLogoutBtn = document.getElementById('authStripLogoutBtn');
  const historyList = document.getElementById('historyList');
  const historyNewBtn = document.getElementById('historyNewBtn');
  const historyViewSwitch = document.getElementById('historyViewSwitch');
  const editEventLink = document.getElementById('editEventLink');
  const saveEventBtn = document.getElementById('saveEventBtn');
  const manageMembersBtn = document.getElementById('manageMembersBtn');
  const goToNotesBtn = document.getElementById('goToNotesBtn');
  const notesBox = document.getElementById('notesBox');
  const notesStatus = document.getElementById('notesStatus');
  const membersView = document.getElementById('membersView');
  const membersList = document.getElementById('membersList');
  const membersBackBtn = document.getElementById('membersBackBtn');
  const addMemberEmailInput = document.getElementById('addMemberEmailInput');
  const addMemberBtn = document.getElementById('addMemberBtn');
  const addMemberStatus = document.getElementById('addMemberStatus');
  const googleCalendarConnectBtn = document.getElementById('googleCalendarConnectBtn');
  const googleTestingNote = document.getElementById('googleTestingNote');
  const reportView = document.getElementById('reportView');
  const reportContent = document.getElementById('reportContent');
  const previewEventDate = document.getElementById('previewEventDate');
  const previewEventEndDate = document.getElementById('previewEventEndDate');
  const eventDateWarning = document.getElementById('eventDateWarning');
  const previewEventLocation = document.getElementById('previewEventLocation');
  const previewNotes = document.getElementById('previewNotes');
  const previewCalendarGuests = document.getElementById('previewCalendarGuests');
  const previewMemberEmails = document.getElementById('previewMemberEmails');
  const previewAllowMemberEdit = document.getElementById('previewAllowMemberEdit');
  const previewDriveFolders = document.getElementById('previewDriveFolders');
  const driveFolderAction = document.getElementById('driveFolderAction');
  const calendarLinkBtn = document.getElementById('calendarLinkBtn');
  const driveFolderLinkBtn = document.getElementById('driveFolderLinkBtn');
  const initErrorView = document.getElementById('initErrorView');
  const accessView = document.getElementById('accessView');
  const eventLinkHint = document.getElementById('eventLinkHint');
  const publishSummary = document.getElementById('publishSummary');
  const publishSummaryList = document.getElementById('publishSummaryList');
  const retryInvitesBtn = document.getElementById('retryInvitesBtn');
  const invitesList = document.getElementById('invitesList');
  const invitesStatus = document.getElementById('invitesStatus');
  const membersRetryInvitesBtn = document.getElementById('membersRetryInvitesBtn');
  const shareSettings = document.getElementById('shareSettings');
  const conflictPanel = document.getElementById('conflictPanel');
  const conflictDiff = document.getElementById('conflictDiff');
  const conflictStatus = document.getElementById('conflictStatus');
  let roteiroSource = null;
  let activeGeneration = null;

  const VIEWS = { loading: loadingView, initError: initErrorView, access: accessView, import: importView, preview: previewView, login: loginView, history: historyView, account: accountView, app: appView, report: reportView, members: membersView };
  function showView(name){
    if(name !== 'import' && activeGeneration) {
      activeGeneration.abort();
      activeGeneration = null;
    }
    if(name === 'import') updateImportContext();
    Object.keys(VIEWS).forEach(key => { VIEWS[key].hidden = key !== name; });
    authStrip.hidden = (name === 'report' || name === 'loading' || name === 'initError');
    window.scrollTo(0, 0);
  }

  let PHASES = [];
  let CONTENT = [];
  let MISSIONS = [];
  let draft = null;
  const recorded = {};
  const missionsDone = {};
  let currentEventId = null;
  let currentEventDate = '';
  let currentEventEndDate = '';
  let currentEventLocation = '';
  let currentDriveFolderId = null;
  let currentOwnerId = null;
  let currentMemberCanEdit = false;
  let editingEventId = null;
  let generatedInPreview = false;
  let eventSaved = false;
  let progressStream = null;
  let streamHadError = false;
  let streamRetryTimer = null;
  let streamRetryDelay = 3000;
  // Como este aparelho chegou ao evento: pelo link (/s/<token>) ou pelo
  // endereço /e/<id> (equipe logada ou link antigo), e o que isso permite.
  let currentAccess = { via: 'id', token: null, role: null, basis: null, canWriteProgress: true, shareMode: null, legacyUntil: null };
  let editingRevision = null;
  let editingLoadedNotes = null;
  let editingShare = null;
  let currentShare = null;
  let conflictState = null;
  let invitePollTimer = null;

  let sb = null;
  let currentUser = null;
  let cachedAccessToken = null;
  const PENDING_DRAFT_KEY = 'captura_pending_draft';
  const PENDING_ROTEIRO_KEY = 'captura_pending_roteiro';
  const HERO_DISMISSED_KEY = 'captura_hero_dismissed';
  const HISTORY_VIEW_KEY = 'captura_history_view';
  const OFFLINE_EVENTS_KEY = 'captura_offline_events';
  const RETURN_TO_KEY = 'captura_return_to';
  const CONFLICT_DRAFT_PREFIX = 'captura_conflict_draft:';
  const SHARE_MODES = ['team', 'view', 'collab'];
  let historyViewMode = localStorage.getItem(HISTORY_VIEW_KEY) || 'list';
  let historyEvents = [];
  let calMonthCursor = null;

  // ---------- helpers ----------

  function escapeHTML(str){
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(str){
    return escapeHTML(str).replace(/"/g, '&quot;');
  }

  function icon(name){ return '<svg class="icon"><use href="#icon-'+name+'"/></svg>'; }

  function iconLabel(name){ return ICON_LABELS[name] || 'Ícone'; }

  // Grade de ícones no lugar do select com nomes em inglês. Fica fechada
  // (mostra o ícone atual + "Trocar"); os radios com o mesmo name dão a
  // navegação por setas do teclado de graça.
  function iconPicker(scope, idx, selected, id, legend){
    const current = ICONS.includes(selected) ? selected : 'flag';
    const options = ICONS.map(name =>
      '<label class="icon-option" title="'+iconLabel(name)+'">'+
        '<input type="radio" name="'+id+'" value="'+name+'" data-scope="'+scope+'" data-idx="'+idx+'" data-field="icon"'+(name===current?' checked':'')+'>'+
        icon(name)+'<span class="sr-only">'+iconLabel(name)+'</span>'+
      '</label>'
    ).join('');
    return (
      '<div class="icon-field">'+
        '<div class="icon-current">'+
          '<span class="icon-current-preview" id="'+id+'-preview" aria-hidden="true">'+icon(current)+'</span>'+
          '<span class="icon-current-name"><span class="sr-only">Ícone: </span><span id="'+id+'-name">'+iconLabel(current)+'</span></span>'+
          '<button type="button" class="btn btn-small" data-action="toggle-icons" aria-expanded="false" aria-controls="'+id+'-grid">Trocar ícone</button>'+
        '</div>'+
        '<fieldset class="icon-grid" id="'+id+'-grid" hidden>'+
          '<legend class="sr-only">'+escapeHTML(legend)+'</legend>'+options+
        '</fieldset>'+
      '</div>'
    );
  }

  // Dá um id estável (`key`) pra cada item de missão. Sem isso, o "feito"
  // era rastreado só pela posição no array — reordenar ou remover um item
  // desalinhava o progresso já marcado de todo mundo depois dele. Aceita
  // tanto o formato antigo (string pura, de evento publicado antes dessa
  // mudança) quanto o novo ({key, text}), pra funcionar com dado já salvo.
  function normalizeMissionItems(items){
    return (items || []).map(function(it){
      if(typeof it === 'string') return { key: 'item_' + Math.random().toString(36).slice(2, 8), text: it };
      return { key: it.key || ('item_' + Math.random().toString(36).slice(2, 8)), text: it.text || '' };
    });
  }

  // Reconcilia a lista de itens depois de editar a caixa de texto (uma linha
  // por item): quem não mudou de texto mantém o mesmo `key` (e o progresso
  // já marcado continua valendo); só texto novo/alterado ganha um `key` novo.
  function reconcileMissionItems(prevItems, newTexts){
    const pool = (prevItems || []).slice();
    return newTexts.map(function(text){
      const idx = pool.findIndex(function(it){ return it.text === text; });
      if(idx !== -1) return pool.splice(idx, 1)[0];
      return { key: 'item_' + Math.random().toString(36).slice(2, 8), text: text };
    });
  }

  // ---------- import ----------

  if(localStorage.getItem(HERO_DISMISSED_KEY)) heroIntro.hidden = true;

  heroDismissBtn.addEventListener('click', function(){
    heroIntro.hidden = true;
    localStorage.setItem(HERO_DISMISSED_KEY, '1');
  });

  exampleBtn.addEventListener('click', function(){
    roteiroInput.value = EXAMPLE_ROTEIRO;
    roteiroInput.focus();
  });

  quickCreateBtn.addEventListener('click', function(){
    if(roteiroSource || activeGeneration) return;
    loadPreview({ event_title: '', phases: [], scenes: [], missions: [] });
  });

  function updateImportContext(){
    const continuing = !!roteiroSource;
    document.getElementById('importTitle').textContent = continuing ? 'Roteiro de ' + roteiroSource.event_title : 'Cole o roteiro do evento';
    document.getElementById('cancelRoteiroBtn').hidden = !continuing;
    document.getElementById('quickCreateRow').hidden = continuing;
    quickCreateBtn.disabled = !!activeGeneration;
    generateBtn.disabled = !!activeGeneration;
    exampleBtn.disabled = !!activeGeneration;
    // quem não entrou sabe antes do clique que gerar pede login
    generateBtn.textContent = activeGeneration ? 'Gerando…' : (currentUser ? 'Gerar checklist' : 'Entrar e gerar checklist');
    document.getElementById('generateLoginHint').hidden = !!currentUser || !!activeGeneration;
  }

  document.getElementById('cancelRoteiroBtn').addEventListener('click', function(){
    // showView cancela a requisição; nenhuma alteração é aplicada ao rascunho.
    showView('preview');
    roteiroSource = null;
  });

  async function runGenerate(text){
    if(activeGeneration) return;
    if(hasRoteiro(roteiroSource) && !confirm('Substituir o roteiro atual? As fases, cenas e missões serão substituídas, e o progresso anterior não será transferido para o novo roteiro. Os dados do evento serão mantidos. A mudança só será publicada ao salvar.')) return;
    const source = roteiroSource;
    const controller = new AbortController();
    activeGeneration = controller;
    importError.hidden = true;
    updateImportContext();
    try {
      const token = await accessToken();
      if(activeGeneration !== controller) return;
      if(!token) throw new Error('Sessão expirada. Faça login de novo.');
      const resp = await fetch('/api/parse-roteiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ text }),
        signal: controller.signal
      });
      const data = await resp.json();
      if(!resp.ok){
        throw new Error(data.error || 'Erro ao gerar o checklist.');
      }
      if(activeGeneration !== controller) return;
      if(!Array.isArray(data.phases) || !Array.isArray(data.scenes) || !Array.isArray(data.missions)) {
        throw new Error('A geração retornou um roteiro inválido. Tente novamente.');
      }
      loadPreview(data, source);
      roteiroSource = null;
    } catch(err){
      if(controller.signal.aborted || activeGeneration !== controller) return;
      importError.textContent = err.message || 'Erro inesperado ao gerar o checklist.';
      importError.hidden = false;
    } finally {
      if(activeGeneration === controller) activeGeneration = null;
      updateImportContext();
    }
  }

  generateBtn.addEventListener('click', async function(){
    const text = roteiroInput.value.trim();
    importError.hidden = true;
    if(text.length < 20){
      importError.textContent = 'Cole um roteiro com mais conteúdo antes de gerar.';
      importError.hidden = false;
      return;
    }
    if(!currentUser){
      localStorage.setItem(PENDING_ROTEIRO_KEY, JSON.stringify({ text, draft: roteiroSource, editingEventId, editing: editingSnapshot() }));
      showLogin('generate');
      return;
    }
    await runGenerate(text);
  });

  // ---------- preview / edit ----------

  function normalizeDraft(data){
    return {
      event_title: data.event_title || 'Evento sem nome',
      event_date: data.event_date || '',
      event_end_date: data.event_end_date || '',
      event_location: data.event_location || '',
      drive_folders: Array.isArray(data.drive_folders) && data.drive_folders.length
        ? data.drive_folders
        : (data.phases || []).map(p => p.label || 'Fase'),
      drive_folder_id: data.drive_folder_id || null,
      calendar_guests: Array.isArray(data.calendar_guests) ? data.calendar_guests : [],
      member_emails: Array.isArray(data.member_emails) ? data.member_emails : [],
      allow_member_edit: !!data.allow_member_edit,
      notes: data.notes || '',
      share_mode: SHARE_MODES.includes(data.share_mode) ? data.share_mode : null,
      phases: (data.phases || []).map(p => ({
        key: p.key || ('fase_' + Math.random().toString(36).slice(2, 8)),
        label: p.label || 'Fase',
        icon: ICONS.includes(p.icon) ? p.icon : 'flag'
      })),
      scenes: (data.scenes || []).map(s => ({
        id: s.id || ('cena_' + Math.random().toString(36).slice(2, 8)),
        phase: s.phase,
        title: s.title || 'Cena sem título',
        icon: ICONS.includes(s.icon) ? s.icon : 'flag',
        formato: s.formato || 'Story ao vivo',
        capture: s.capture || [],
        speech: s.speech || '',
        can: s.can || [],
        cannot: s.cannot || []
      })),
      missions: (data.missions || []).map(m => ({
        key: m.key || ('missao_' + Math.random().toString(36).slice(2, 8)),
        emoji: m.emoji || '',
        label: m.label || 'Categoria',
        items: normalizeMissionItems(m.items)
      }))
    };
  }

  function loadPreview(data, existing = null){
    generatedInPreview = hasRoteiro(data);
    draft = mergeGeneratedRoteiro(existing, normalizeDraft(data));
    // evento novo começa como sempre funcionou: link para colaborar
    if(!editingEventId && !draft.share_mode) draft.share_mode = 'collab';
    updatePreviewContext();
    renderPreviewAll();
    showView('preview');
  }

  function updatePreviewContext(){
    const content = hasRoteiro(draft);
    document.getElementById('previewHeading').textContent = !content
      ? (editingEventId ? 'Atualize os dados do evento' : 'Reserve a data do evento')
      : (generatedInPreview
        ? (editingEventId ? 'Revise o roteiro antes de salvar' : 'Revise o roteiro antes de publicar')
        : 'Edite os dados e o roteiro');
    publishBtn.textContent = editingEventId ? 'Salvar alterações' : (content ? 'Publicar checklist' : 'Criar evento');
  }

  function renderPreviewAll(){
    applySectionDefaults();
    updatePreviewContext();
    document.getElementById('previewBackBtn').textContent = hasRoteiro(draft) ? 'Substituir roteiro' : 'Adicionar roteiro';
    document.getElementById('previewEventTitle').value = draft.event_title;
    previewEventDate.value = draft.event_date || '';
    previewEventEndDate.value = draft.event_end_date || '';
    previewEventLocation.value = draft.event_location || '';
    previewCalendarGuests.value = (draft.calendar_guests || []).join('\n');
    previewMemberEmails.value = (draft.member_emails || []).join('\n');
    previewAllowMemberEdit.checked = !!draft.allow_member_edit;
    previewNotes.value = draft.notes || '';
    previewDriveFolders.value = (draft.drive_folders || []).join('\n');
    renderDriveFolderAction();
    validateEventDates();
    renderShareSettings();

    previewPhasesContainer.innerHTML = draft.phases.map((phase, pIdx) => {
      const scenesInPhase = draft.scenes
        .map((s, i) => ({ s, i }))
        .filter(x => x.s.phase === phase.key);

      const phaseOptions = draft.phases.map(p =>
        '<option value="'+escapeAttr(p.key)+'"'+(p.key===phase.key?' selected':'')+'>'+escapeHTML(p.label)+'</option>'
      ).join('');

      const sceneCards = scenesInPhase.map(({s, i}, localIdx) => {
        const scenePhaseOptions = draft.phases.map(p =>
          '<option value="'+escapeAttr(p.key)+'"'+(p.key===s.phase?' selected':'')+'>'+escapeHTML(p.label)+'</option>'
        ).join('');
        const open = openSceneIds.has(s.id);
        return (
          '<div class="preview-scene-card'+(open?' is-open':'')+'">'+
            '<div class="preview-scene-top">'+
              '<button type="button" class="scene-toggle" data-action="toggle-scene" data-scene-id="'+escapeAttr(s.id)+'" aria-expanded="'+open+'" aria-controls="scene-body-'+i+'">'+
                '<svg class="icon scene-toggle-chevron" aria-hidden="true" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>'+
                '<span class="scene-toggle-icon" id="edit-scene-'+i+'-icon-preview-head" aria-hidden="true">'+icon(ICONS.includes(s.icon) ? s.icon : 'flag')+'</span>'+
                '<span class="scene-toggle-text">'+
                  '<span class="scene-toggle-title" id="scene-title-'+i+'">'+escapeHTML(s.title || 'Cena sem título')+'</span>'+
                  '<span class="scene-toggle-meta" id="scene-meta-'+i+'">'+sceneMeta(localIdx, s)+'</span>'+
                '</span>'+
              '</button>'+
              '<div class="preview-scene-actions">'+
                '<button type="button" class="icon-btn" aria-label="Mover cena para cima" data-action="move-scene-up" data-idx="'+i+'" '+(localIdx===0?'disabled':'')+'>'+icon('arrow-up')+'</button>'+
                '<button type="button" class="icon-btn" aria-label="Mover cena para baixo" data-action="move-scene-down" data-idx="'+i+'" '+(localIdx===scenesInPhase.length-1?'disabled':'')+'>'+icon('arrow-down')+'</button>'+
                '<button type="button" class="icon-btn danger" aria-label="Remover cena" data-action="remove-scene" data-idx="'+i+'">'+icon('x')+'</button>'+
              '</div>'+
            '</div>'+
            '<div class="preview-scene-body" id="scene-body-'+i+'"'+(open?'':' hidden')+'>'+
            '<div class="field-grid field-row">'+
              '<div><label class="field-label" for="edit-scene-'+i+'-title">Título</label><input id="edit-scene-'+i+'-title" class="field-input" data-scope="scene" data-idx="'+i+'" data-field="title" value="'+escapeAttr(s.title)+'"></div>'+
              '<div><label class="field-label" for="edit-scene-'+i+'-phase">Fase</label><select id="edit-scene-'+i+'-phase" class="field-select" data-scope="scene" data-idx="'+i+'" data-field="phase">'+scenePhaseOptions+'</select></div>'+
            '</div>'+
            '<div class="field-grid field-row">'+
              '<div><span class="field-label">Ícone</span>'+iconPicker('scene', i, s.icon, 'edit-scene-'+i+'-icon', 'Ícone da cena')+'</div>'+
              '<div><label class="field-label" for="edit-scene-'+i+'-formato">Formato</label><input id="edit-scene-'+i+'-formato" class="field-input" data-scope="scene" data-idx="'+i+'" data-field="formato" value="'+escapeAttr(s.formato)+'"></div>'+
            '</div>'+
            '<div class="field-row"><label class="field-label" for="edit-scene-'+i+'-capture">Captura (uma por linha)</label><textarea id="edit-scene-'+i+'-capture" class="field-textarea" data-scope="scene" data-idx="'+i+'" data-field="capture" data-list="true">'+escapeHTML((s.capture||[]).join('\n'))+'</textarea></div>'+
            '<div class="field-row"><label class="field-label" for="edit-scene-'+i+'-speech">Fala / texto sugerido</label><textarea id="edit-scene-'+i+'-speech" class="field-textarea" style="min-height:44px;" data-scope="scene" data-idx="'+i+'" data-field="speech">'+escapeHTML(s.speech||'')+'</textarea></div>'+
            '<div class="field-grid field-row">'+
              '<div><label class="field-label" for="edit-scene-'+i+'-can">Pode (uma por linha)</label><textarea id="edit-scene-'+i+'-can" class="field-textarea" data-scope="scene" data-idx="'+i+'" data-field="can" data-list="true">'+escapeHTML((s.can||[]).join('\n'))+'</textarea></div>'+
              '<div><label class="field-label" for="edit-scene-'+i+'-cannot">Não pode (uma por linha)</label><textarea id="edit-scene-'+i+'-cannot" class="field-textarea" data-scope="scene" data-idx="'+i+'" data-field="cannot" data-list="true">'+escapeHTML((s.cannot||[]).join('\n'))+'</textarea></div>'+
            '</div>'+
            '</div>'+
          '</div>'
        );
      }).join('');

      return (
        '<div class="preview-phase-block">'+
          '<div class="preview-phase-head">'+
            '<div class="field-row"><label class="field-label" for="edit-phase-'+pIdx+'-label">Fase</label><input id="edit-phase-'+pIdx+'-label" class="field-input" data-scope="phase" data-idx="'+pIdx+'" data-field="label" value="'+escapeAttr(phase.label)+'"></div>'+
            '<div class="preview-phase-actions">'+
              '<button type="button" class="icon-btn" aria-label="Mover fase para cima" data-action="move-phase-up" data-idx="'+pIdx+'" '+(pIdx===0?'disabled':'')+'>'+icon('arrow-up')+'</button>'+
              '<button type="button" class="icon-btn" aria-label="Mover fase para baixo" data-action="move-phase-down" data-idx="'+pIdx+'" '+(pIdx===draft.phases.length-1?'disabled':'')+'>'+icon('arrow-down')+'</button>'+
              '<button type="button" class="icon-btn danger" aria-label="Remover fase" data-action="remove-phase" data-idx="'+pIdx+'">'+icon('x')+'</button>'+
            '</div>'+
          '</div>'+
          '<div class="preview-phase-icon">'+iconPicker('phase', pIdx, phase.icon, 'edit-phase-'+pIdx+'-icon', 'Ícone da fase')+'</div>'+
          sceneCards+
          '<button type="button" class="add-btn" data-action="add-scene" data-phase-idx="'+pIdx+'">+ Adicionar cena nesta fase</button>'+
        '</div>'
      );
    }).join('');

    roteiroEmpty.hidden = !!(draft.phases.length || draft.scenes.length);
    renderPreviewMissions();
    updateSectionSummaries();
  }

  // ---------- seções da tela de criar/editar ----------
  // Evento e roteiro abertos; equipe e Google recolhidos com uma linha de
  // resumo. O padrão só é aplicado quando um rascunho novo entra na tela —
  // re-renderizar (mover cena, trocar fase) mantém o que a pessoa abriu.

  const sectionEvent = document.getElementById('sectionEvent');
  const sectionRoteiro = document.getElementById('sectionRoteiro');
  const sectionTeam = document.getElementById('sectionTeam');
  const sectionGoogle = document.getElementById('sectionGoogle');
  const roteiroEmpty = document.getElementById('roteiroEmpty');
  const openSceneIds = new Set();
  let sectionsDraft = null;

  function applySectionDefaults(){
    if(draft === sectionsDraft) return;
    sectionsDraft = draft;
    openSceneIds.clear();
    sectionEvent.open = true;
    sectionRoteiro.open = hasRoteiro(draft);
    sectionTeam.open = false;
    sectionGoogle.open = false;
    refreshPreviewGoogleStatus();
  }

  function sceneMeta(localIdx, s){
    const n = (s.capture || []).length;
    return 'Cena ' + (localIdx + 1) + ' · ' + (n ? pluralize(n, 'item de captura', 'itens de captura') : 'sem itens de captura');
  }

  function formatEventWhen(value){
    const d = new Date(value);
    if(!value || isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' às ' +
      d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  const SHARE_MODE_LABELS = { team: 'Somente equipe', view: 'Link para visualizar', collab: 'Link para colaborar' };

  function updateSectionSummaries(){
    if(!draft) return;
    const when = formatEventWhen(draft.event_date);
    const eventParts = [when, (draft.event_location || '').trim()].filter(Boolean);
    document.getElementById('sectionEventSummary').textContent = eventParts.length ? eventParts.join(' · ') : 'Sem data e local';

    const roteiroParts = [];
    if(draft.phases.length) roteiroParts.push(pluralize(draft.phases.length, 'fase', 'fases'));
    if(draft.scenes.length) roteiroParts.push(pluralize(draft.scenes.length, 'cena', 'cenas'));
    if(draft.missions.length) roteiroParts.push(pluralize(draft.missions.length, 'missão', 'missões'));
    document.getElementById('sectionRoteiroSummary').textContent = roteiroParts.length ? roteiroParts.join(' · ') : 'Sem roteiro ainda';

    const members = (draft.member_emails || []).length;
    const teamParts = [members ? pluralize(members, 'membro', 'membros') : 'Nenhum membro'];
    if(!shareSettings.hidden && SHARE_MODE_LABELS[draft.share_mode]) teamParts.push(SHARE_MODE_LABELS[draft.share_mode]);
    document.getElementById('sectionTeamSummary').textContent = teamParts.join(' · ');

    const guests = (draft.calendar_guests || []).length;
    const folders = (draft.drive_folders || []).length;
    const googleParts = [];
    if(guests) googleParts.push(pluralize(guests, 'convidado', 'convidados'));
    if(draft.drive_folder_id) googleParts.push('pasta criada no Drive');
    else if(folders) googleParts.push(pluralize(folders, 'pasta planejada', 'pastas planejadas'));
    document.getElementById('sectionGoogleSummary').textContent = googleParts.length ? googleParts.join(' · ') : 'Nada configurado';
  }

  previewView.addEventListener('input', updateSectionSummaries);
  previewView.addEventListener('change', updateSectionSummaries);

  document.getElementById('roteiroEmptyAddBtn').addEventListener('click', function(){
    document.getElementById('previewBackBtn').click();
  });

  function toggleScene(btn){
    const id = btn.dataset.sceneId;
    const body = document.getElementById(btn.getAttribute('aria-controls'));
    const open = btn.getAttribute('aria-expanded') !== 'true';
    if(open) openSceneIds.add(id); else openSceneIds.delete(id);
    btn.setAttribute('aria-expanded', String(open));
    if(body) body.hidden = !open;
    const card = btn.closest('.preview-scene-card');
    if(card) card.classList.toggle('is-open', open);
  }

  function toggleIconGrid(btn){
    const grid = document.getElementById(btn.getAttribute('aria-controls'));
    if(!grid) return;
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    grid.hidden = !open;
    if(open){
      const checked = grid.querySelector('input:checked') || grid.querySelector('input');
      if(checked) checked.focus();
    }
  }

  // Escolher com mouse/toque fecha a grade; com as setas do teclado a grade
  // fica aberta (cada seta já troca a seleção).
  let lastIconPointer = 0;
  previewView.addEventListener('pointerdown', function(e){
    if(e.target.closest && e.target.closest('.icon-option')) lastIconPointer = Date.now();
  });
  previewView.addEventListener('change', function(e){
    const grid = e.target.closest && e.target.closest('.icon-grid');
    if(!grid || Date.now() - lastIconPointer > 1500) return;
    const btn = previewView.querySelector('[aria-controls="'+grid.id+'"]');
    if(!btn) return;
    btn.setAttribute('aria-expanded', 'false');
    grid.hidden = true;
    btn.focus();
  });

  // A linha da cena recolhida acompanha o que é digitado dentro dela.
  function refreshSceneHead(idx){
    const s = draft.scenes[idx];
    if(!s) return;
    const localIdx = draft.scenes.slice(0, idx).filter(x => x.phase === s.phase).length;
    const title = document.getElementById('scene-title-'+idx);
    const meta = document.getElementById('scene-meta-'+idx);
    const headIcon = document.getElementById('edit-scene-'+idx+'-icon-preview-head');
    if(title) title.textContent = s.title || 'Cena sem título';
    if(meta) meta.textContent = sceneMeta(localIdx, s);
    if(headIcon) headIcon.innerHTML = icon(ICONS.includes(s.icon) ? s.icon : 'flag');
  }

  function updateIconPreview(id, name){
    const preview = document.getElementById(id + '-preview');
    const label = document.getElementById(id + '-name');
    if(preview) preview.innerHTML = icon(name);
    if(label) label.textContent = iconLabel(name);
  }

  function renderPreviewMissions(){
    updatePreviewContext();
    previewMissionsContainer.innerHTML = draft.missions.map((cat, cIdx) => (
      '<div class="preview-mission-block">'+
        '<div class="preview-scene-top">'+
          '<span class="field-label" style="margin:0;">Categoria</span>'+
          '<button type="button" class="icon-btn danger" aria-label="Remover categoria de missão" data-action="remove-mission-cat" data-idx="'+cIdx+'">'+icon('x')+'</button>'+
        '</div>'+
        '<div class="field-grid field-row">'+
          '<div><label class="field-label" for="edit-missionCat-'+cIdx+'-label">Nome</label><input id="edit-missionCat-'+cIdx+'-label" class="field-input" data-scope="missionCat" data-idx="'+cIdx+'" data-field="label" value="'+escapeAttr(cat.label)+'"></div>'+
          '<div><label class="field-label" for="edit-missionCat-'+cIdx+'-emoji">Emoji</label><input id="edit-missionCat-'+cIdx+'-emoji" class="field-input" data-scope="missionCat" data-idx="'+cIdx+'" data-field="emoji" value="'+escapeAttr(cat.emoji||'')+'"></div>'+
        '</div>'+
        '<div class="field-row"><label class="field-label" for="edit-missionItems-'+cIdx+'-items">Itens (um por linha)</label><textarea id="edit-missionItems-'+cIdx+'-items" class="field-textarea" data-scope="missionItems" data-idx="'+cIdx+'" data-field="items" data-list="true">'+escapeHTML((cat.items||[]).map(function(it){ return it.text; }).join('\n'))+'</textarea></div>'+
      '</div>'
    )).join('');
  }

  function moveSceneWithinPhase(idx, direction){
    const scene = draft.scenes[idx];
    const sameGroup = draft.scenes.map((s, i) => ({ s, i })).filter(x => x.s.phase === scene.phase);
    const posInGroup = sameGroup.findIndex(x => x.i === idx);
    const swapWith = sameGroup[posInGroup + direction];
    if(!swapWith) return;
    const tmp = draft.scenes[idx];
    draft.scenes[idx] = draft.scenes[swapWith.i];
    draft.scenes[swapWith.i] = tmp;
    renderPreviewAll();
  }

  function handlePreviewFieldChange(e){
    if(!draft) return;
    const el = e.target;
    const scope = el.dataset.scope;
    if(!scope) return;
    const idx = Number(el.dataset.idx);
    const field = el.dataset.field;
    let value = el.value;
    if(el.dataset.list === 'true'){
      value = value.split('\n').map(s => s.trim()).filter(Boolean);
    }
    if(scope === 'phase'){
      draft.phases[idx][field] = value;
      if(field === 'icon') updateIconPreview('edit-phase-'+idx+'-icon', value);
    } else if(scope === 'scene'){
      draft.scenes[idx][field] = value;
      if(field === 'phase'){ renderPreviewAll(); return; }
      refreshSceneHead(idx);
      if(field === 'icon') updateIconPreview('edit-scene-'+idx+'-icon', value);
    } else if(scope === 'missionCat'){
      draft.missions[idx][field] = value;
    } else if(scope === 'missionItems'){
      draft.missions[idx].items = reconcileMissionItems(draft.missions[idx].items, value);
    }
  }

  previewPhasesContainer.addEventListener('input', handlePreviewFieldChange);
  previewPhasesContainer.addEventListener('change', handlePreviewFieldChange);
  previewMissionsContainer.addEventListener('input', handlePreviewFieldChange);
  previewMissionsContainer.addEventListener('change', handlePreviewFieldChange);

  document.getElementById('previewEventTitle').addEventListener('input', function(e){
    if(draft) draft.event_title = e.target.value;
  });

  function validateEventDates(){
    const startVal = previewEventDate.value;
    const endVal = previewEventEndDate.value;
    if(!startVal || !endVal){
      eventDateWarning.hidden = true;
      return;
    }
    const start = new Date(startVal);
    const end = new Date(endVal);
    const invalid = isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start;
    eventDateWarning.hidden = !invalid;
    // aviso não pode ficar escondido dentro de uma seção fechada
    if(invalid) sectionEvent.open = true;
  }

  previewEventDate.addEventListener('input', function(e){
    if(draft) draft.event_date = e.target.value;
    validateEventDates();
  });

  previewEventEndDate.addEventListener('input', function(e){
    if(draft) draft.event_end_date = e.target.value;
    validateEventDates();
  });

  previewEventLocation.addEventListener('input', function(e){
    if(draft) draft.event_location = e.target.value;
  });

  previewDriveFolders.addEventListener('input', function(e){
    if(draft) draft.drive_folders = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
  });

  previewCalendarGuests.addEventListener('input', function(e){
    if(draft) draft.calendar_guests = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
  });

  previewMemberEmails.addEventListener('input', function(e){
    if(draft) draft.member_emails = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
  });

  previewAllowMemberEdit.addEventListener('change', function(e){
    if(draft) draft.allow_member_edit = !!e.target.checked;
  });

  previewNotes.addEventListener('input', function(e){
    if(draft) draft.notes = e.target.value;
  });

  function driveButtonLabel(isUpdate){
    return isUpdate ? icon('refresh')+'Adicionar pastas novas ao Drive' : icon('folder')+'Criar estrutura no Google Drive';
  }

  function renderDriveFolderAction(){
    if(draft.drive_folder_id){
      driveFolderAction.innerHTML =
        '<div class="import-actions import-actions--flush">'+
          '<a class="btn" href="https://drive.google.com/drive/folders/'+encodeURIComponent(draft.drive_folder_id)+'" target="_blank" rel="noopener">'+icon('folder')+'Abrir pasta no Drive</a>'+
          '<button class="btn" id="updateDriveFolderBtn" type="button">'+driveButtonLabel(true)+'</button>'+
        '</div>';
    } else {
      driveFolderAction.innerHTML = '<button class="btn" id="createDriveFolderBtn" type="button">'+driveButtonLabel(false)+'</button>';
    }
    updateSectionSummaries();
  }

  async function createDriveFolderStructure(){
    const folders = previewDriveFolders.value.split('\n').map(s => s.trim()).filter(Boolean);
    if(!folders.length){
      alert('Adicione pelo menos um nome de pasta antes de criar a estrutura.');
      return;
    }
    // com drive_folder_id já existindo, isso só ACRESCENTA pasta nova à
    // estrutura publicada — nunca remove nem duplica o que já existe, mesmo
    // que uma linha tenha sido apagada da caixa de texto.
    const isUpdate = !!draft.drive_folder_id;
    const btnId = isUpdate ? 'updateDriveFolderBtn' : 'createDriveFolderBtn';
    const btn = document.getElementById(btnId);
    if(btn){ btn.disabled = true; btn.textContent = isUpdate ? 'Atualizando…' : 'Criando…'; }
    try {
      const token = await accessToken();
      if(!token) throw new Error('Faça login pra usar essa função.');
      const resp = await fetch('/api/google/drive-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ eventTitle: draft.event_title, folders, existingRootId: draft.drive_folder_id || undefined })
      });
      const result = await resp.json();
      if(!resp.ok) throw new Error(result.error || 'Erro ao ' + (isUpdate ? 'atualizar' : 'criar') + ' a estrutura.');
      draft.drive_folder_id = result.folderId;
      renderDriveFolderAction();
      if(isUpdate) alert('Estrutura atualizada: pastas novas foram criadas no Drive. Nada existente foi removido ou duplicado.');
    } catch(err){
      alert('Não consegui ' + (isUpdate ? 'atualizar' : 'criar') + ' a estrutura (' + (err.message || 'erro desconhecido') + ').');
      if(btn){ btn.disabled = false; btn.innerHTML = driveButtonLabel(isUpdate); }
    }
  }

  document.getElementById('addPhaseBtn').addEventListener('click', function(){
    draft.phases.push({ key: 'fase_' + Math.random().toString(36).slice(2, 8), label: 'Nova fase', icon: 'flag' });
    renderPreviewAll();
  });

  document.getElementById('addMissionBtn').addEventListener('click', function(){
    draft.missions.push({ key: 'missao_' + Math.random().toString(36).slice(2, 8), emoji: '✨', label: 'Nova categoria', items: [] });
    renderPreviewMissions();
  });

  document.getElementById('previewBackBtn').addEventListener('click', function(){
    roteiroSource = draft;
    importError.hidden = true;
    showView('import');
  });

  const publishBtn = document.getElementById('publishBtn');
  publishBtn.addEventListener('click', async function(){
    draft.event_title = document.getElementById('previewEventTitle').value.trim() || 'Evento sem nome';
    if(!draft.scenes.length && !confirm('Salvar o evento sem roteiro? Você poderá adicionar as fases e cenas depois, mantendo o mesmo link.')){
      return;
    }

    if(!currentUser){
      localStorage.setItem(PENDING_DRAFT_KEY, JSON.stringify({ draft, editingEventId, generatedInPreview, editing: editingSnapshot() }));
      showLogin('publish');
      return;
    }

    const wasEditing = editingEventId;
    // Com conflito aberto, salvar apagaria a alteração da outra pessoa.
    if(wasEditing && conflictState && conflictState.eventId === wasEditing){
      alert('Este evento foi alterado por outra pessoa. Compare as versões e recarregue a mais recente antes de salvar (copie seu rascunho se precisar).');
      conflictPanel.hidden = false;
      window.scrollTo(0, 0);
      return;
    }
    publishBtn.disabled = true;
    publishBtn.textContent = wasEditing ? 'Salvando…' : 'Publicando…';
    try {
      const token = await accessToken();
      if(!token) throw new Error('Sessão expirada. Faça login de novo.');
      const url = wasEditing ? '/api/events/' + wasEditing : '/api/events';
      const method = wasEditing ? 'PATCH' : 'POST';
      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(buildSaveBody(wasEditing))
      });
      const result = await resp.json();
      if(resp.status === 409 && result.code === 'conflict'){
        showConflict(wasEditing, result.current);
        return;
      }
      // Rascunho sem versão conhecida (aba antiga): trata como conflito com a atual.
      if(resp.status === 428 && result.code === 'revision_required'){
        const latest = await fetchEventData('id', wasEditing);
        if(latest.resp.ok){ showConflict(wasEditing, latest.data); return; }
      }
      if(!resp.ok){
        throw new Error(result.error || 'Erro ao salvar o evento.');
      }
      const id = wasEditing || result.id;
      const wasOwnerSave = !wasEditing || isOwner();
      if(!wasEditing) currentOwnerId = currentUser.id;
      currentDriveFolderId = draft.drive_folder_id || null;
      clearConflict(wasEditing);
      editingEventId = null;
      editingRevision = null;
      setAccess({ via: 'id', role: isOwner() ? 'owner' : (currentMemberCanEdit ? 'editor' : 'member'), canWriteProgress: true, shareMode: result.share?.share_mode || draft.share_mode });
      if(result.share) currentShare = result.share;
      loadChecklist(draft);
      history.pushState({}, '', '/e/' + id);
      showEventLink(id);
      renderPublishSummary(result.members, { canRetry: wasOwnerSave });
      if(!wasEditing) showPublishShare();
    } catch(err){
      alert('Não consegui salvar (' + (err.message || 'erro desconhecido') + ').');
    } finally {
      publishBtn.disabled = false;
      updatePreviewContext();
    }
  });

  // Corpo do salvamento. Na edição vai a versão que foi aberta (o servidor
  // recusa se outra pessoa salvou depois) e as notas só se mudaram aqui —
  // senão uma edição do roteiro apagaria anotações feitas ao vivo.
  function buildSaveBody(wasEditing){
    const body = Object.assign({}, draft);
    if(wasEditing){
      body.base_revision = editingRevision;
      if(draft.notes === editingLoadedNotes) delete body.notes;
      // modo de acesso só vai se o dono mudou de fato nesta tela
      if(!editingShare || draft.share_mode === editingShare.share_mode) delete body.share_mode;
    }
    return body;
  }

  // ---------- live checklist ----------

  function cardHTML(item){
    const captureItems = item.capture.map(t=>'<li>'+escapeHTML(t)+'</li>').join('');
    let rulesHTML = '';
    const hasCan = item.can && item.can.length;
    const hasCannot = item.cannot && item.cannot.length;
    if(hasCan || hasCannot){
      const canItems = (item.can||[]).map(t=>'<li>'+escapeHTML(t)+'</li>').join('');
      const cannotItems = (item.cannot||[]).map(t=>'<li>'+escapeHTML(t)+'</li>').join('');
      if(hasCannot){
        rulesHTML =
          '<div class="rules-col can'+(hasCannot?'':' full')+'"><div class="rules-title">'+icon('check')+' Pode</div><ul>'+canItems+'</ul></div>'+
          '<div class="rules-col cannot"><div class="rules-title">'+icon('x')+' Não pode</div><ul>'+cannotItems+'</ul></div>';
      } else {
        rulesHTML = '<div class="rules-col can full"><div class="rules-title">'+icon('check')+' Pode</div><ul>'+canItems+'</ul></div>';
      }
    }
    const orderStr = String(item.order).padStart(2,'0');
    const speechHTML = item.speech
      ? '<div class="speech-box"><span class="speech-label">Frase / texto sugerido</span><p class="speech-text">'+escapeHTML(item.speech)+'</p></div>'
      : '';
    // Em campo o que importa primeiro é marcar e saber o que capturar; fala
    // e pode/não pode ficam a um toque.
    const detailsLabel = item.speech && rulesHTML ? 'Fala sugerida e regras'
      : (item.speech ? 'Fala sugerida' : 'Regras: pode e não pode');
    const detailsHTML = (speechHTML || rulesHTML)
      ? '<details class="card-details"><summary>'+detailsLabel+'</summary>'+
          '<div class="card-details-body">'+speechHTML+(rulesHTML ? '<div class="rules-grid">'+rulesHTML+'</div>' : '')+'</div>'+
        '</details>'
      : '';
    const meta = 'Cena '+orderStr+'/'+String(CONTENT.length).padStart(2,'0')+(item.formato ? ' · '+escapeHTML(item.formato) : '');
    return (
      '<article class="card" id="card-'+item.id+'" data-id="'+item.id+'">'+
        '<span class="vf-corner tl"></span><span class="vf-corner tr"></span>'+
        '<span class="vf-corner bl"></span><span class="vf-corner br"></span>'+
        '<span class="captured-stamp" id="stamp-'+item.id+'">CAPTURADO</span>'+
        '<div class="card-head">'+
          '<div class="card-icon">'+icon(item.icon)+'</div>'+
          '<div class="card-head-text">'+
            '<h3 class="card-title" id="card-title-'+item.id+'" tabindex="-1">'+escapeHTML(item.title)+'</h3>'+
            '<p class="card-meta">'+meta+'</p>'+
          '</div>'+
          '<div class="status-indicator"><span class="dot"></span><span class="check">'+icon('check')+'</span></div>'+
        '</div>'+
        '<div class="status-btn-group" data-id="'+item.id+'">'+
          '<button class="status-btn active" type="button" data-status="nao_iniciado" data-id="'+item.id+'">Não iniciado</button>'+
          '<button class="status-btn" type="button" data-status="andamento" data-id="'+item.id+'">Em andamento</button>'+
          '<button class="status-btn" type="button" data-status="feito" data-id="'+item.id+'">Feito</button>'+
          '<button class="status-btn" type="button" data-status="postado" data-id="'+item.id+'">Postado</button>'+
        '</div>'+
        '<div class="status-times" id="times-'+item.id+'"></div>'+
        (captureItems ? '<ul class="capture-list">'+captureItems+'</ul>' : '')+
        detailsHTML+
      '</article>'
    );
  }

  function loadChecklist(data){
    PHASES = data.phases || [];
    MISSIONS = (data.missions || []).map(function(m){
      return Object.assign({}, m, { items: normalizeMissionItems(m.items) });
    });

    const phaseOrder = {};
    PHASES.forEach((p, i) => { phaseOrder[p.key] = i; });

    CONTENT = (data.scenes || [])
      .slice()
      .sort((a, b) => (phaseOrder[a.phase] ?? 999) - (phaseOrder[b.phase] ?? 999))
      .map((scene, idx) => ({
        id: scene.id || (idx + 1),
        phase: scene.phase,
        order: idx + 1,
        title: scene.title || 'Cena sem título',
        icon: scene.icon || 'flag',
        formato: scene.formato || 'Story ao vivo',
        capture: scene.capture || [],
        speech: scene.speech || '',
        can: scene.can || [],
        cannot: scene.cannot || []
      }));

    Object.keys(recorded).forEach(k => delete recorded[k]);
    Object.keys(missionsDone).forEach(k => delete missionsDone[k]);

    document.getElementById('eventTitle').textContent = data.event_title || 'Evento sem nome';
    currentEventDate = data.event_date || '';
    currentEventEndDate = data.event_end_date || '';
    currentEventLocation = data.event_location || '';
    const subParts = [formatEventWhen(currentEventDate), currentEventLocation.trim()].filter(Boolean);
    document.getElementById('eventSub').textContent = subParts.length
      ? subParts.join(' · ')
      : pluralize(CONTENT.length, 'cena', 'cenas') + ' em ' + pluralize(PHASES.length, 'fase', 'fases');
    notesBox.value = data.notes || '';
    notesStatus.textContent = '';
    updateNotesPreview();

    render();
    renderMissions();
    pendingOnly = readPendingOnly();

    if(data.progress){
      Object.entries(data.progress.recorded || {}).forEach(([sceneId, entry]) => applyStatus(sceneId, entry));
      Object.entries(data.progress.missionsDone || {}).forEach(([key, done]) => { if(done) applyMissionKey(key, true); });
    }

    updateAll();
    updateMissions();
    hidePublishSummary();
    applyReadOnlyState();
    applyPendingFilter();
    closeMoreMenu(false);

    showView('app');
  }

  // Link só de visualização: a checklist aparece, mas marcar progresso fica
  // bloqueado aqui também (o servidor recusa de qualquer forma).
  // Reiniciar apaga o progresso de todos: só dono e editores (o servidor confere).
  function canReset(){
    return currentAccess.role === 'owner' || currentAccess.role === 'editor';
  }

  function applyReadOnlyState(){
    const readOnly = !currentAccess.canWriteProgress;
    appView.classList.toggle('is-readonly', readOnly);
    document.querySelectorAll('.status-btn, .mission-chip').forEach(btn => { btn.disabled = readOnly; });
    document.getElementById('resetBtn').hidden = readOnly || !canReset();
    document.getElementById('readonlyNotice').hidden = !readOnly;
  }

  function setAccess(next){
    currentAccess = Object.assign({ via: 'id', token: null, role: null, basis: null, canWriteProgress: true, shareMode: null, legacyUntil: null }, next);
  }

  function accessFromData(data, via, token){
    const a = data && data.access;
    if(!a) return { via, token, role: null, basis: null, canWriteProgress: true, shareMode: null, legacyUntil: null };
    return { via, token, role: a.role || null, basis: a.basis || null, canWriteProgress: !!a.can_write_progress, shareMode: a.share_mode || null, legacyUntil: a.legacy_link_until || null };
  }

  function backToImport(){
    roteiroSource = null;
    draft = null;
    showView('import');
    importError.hidden = true;
    hideEventLink();
    disconnectProgressStream();
    currentOwnerId = null;
    editingEventId = null;
    editingRevision = null;
    editingShare = null;
    currentShare = null;
    setAccess({});
    updateEditLinkVisibility();
    history.pushState({}, '', '/');
  }

  function buildGoogleCalendarUrl(title, startLocalStr, endLocalStr, location, eventLink){
    if(!startLocalStr) return null;
    const start = new Date(startLocalStr);
    if(isNaN(start.getTime())) return null;
    let end = endLocalStr ? new Date(endLocalStr) : null;
    if(!end || isNaN(end.getTime()) || end <= start){
      end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    }
    const fmt = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: title || 'Evento',
      dates: fmt(start) + '/' + fmt(end),
      details: 'Checklist do CAPTURA: ' + eventLink
    });
    if(location) params.set('location', location);
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  function formatDateBR(iso){
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  // Qual link mostrar pra copiar depende de quem está vendo: o dono vê o link
  // de compartilhamento (se o modo permite), a equipe vê o endereço da equipe,
  // e quem entrou por um link vê o próprio link.
  function eventLinkFor(id){
    const origin = window.location.origin;
    const teamLink = origin + '/e/' + id;
    if(currentAccess.role === 'owner'){
      const mode = currentShare && currentShare.share_mode;
      if(currentShare && currentShare.share_path && mode !== 'team'){
        return { link: origin + currentShare.share_path, label: 'Link de compartilhamento', hint: mode === 'view' ? 'Quem tiver este link só visualiza. Mude em "Editar evento".' : 'Quem tiver este link vê e marca progresso, sem conta. Mude em "Editar evento".' };
      }
      return { link: teamLink, label: 'Link da equipe', hint: mode === 'team' ? 'Somente equipe: só abre pra membros com conta.' : 'Link de compartilhamento desativado: só abre pra membros com conta.' };
    }
    if(currentAccess.role) return { link: teamLink, label: 'Link da equipe', hint: 'Abre pra quem é da equipe, com conta.' };
    if(currentAccess.via === 'token') return { link: origin + '/s/' + currentAccess.token, label: 'Link do evento', hint: currentAccess.canWriteProgress ? '' : 'Este link só permite visualizar.' };
    const until = currentAccess.legacyUntil ? formatDateBR(currentAccess.legacyUntil) : '';
    return { link: teamLink, label: 'Link do evento (endereço antigo)', hint: until ? 'Endereço antigo: deixa de abrir sem conta em ' + until + '. Peça o link novo a quem organiza.' : '' };
  }

  function showEventLink(id){
    const row = document.getElementById('eventLinkRow');
    const input = document.getElementById('eventLinkInput');
    const info = eventLinkFor(id);
    const link = info.link;
    input.value = link;
    document.getElementById('eventLinkLabel').textContent = info.label;
    eventLinkHint.textContent = info.hint;
    row.hidden = false;
    currentEventId = id;
    connectProgressStream();
    updateEditLinkVisibility();
    refreshSaveButton();
    refreshManageMembersButton();
    refreshNotesEditability();

    const calUrl = buildGoogleCalendarUrl(document.getElementById('eventTitle').textContent, currentEventDate, currentEventEndDate, currentEventLocation, link);
    if(calUrl){
      calendarLinkBtn.href = calUrl;
      calendarLinkBtn.hidden = false;
    } else {
      calendarLinkBtn.hidden = true;
    }

    if(currentDriveFolderId){
      driveFolderLinkBtn.href = 'https://drive.google.com/drive/folders/' + encodeURIComponent(currentDriveFolderId);
      driveFolderLinkBtn.hidden = false;
    } else {
      driveFolderLinkBtn.hidden = true;
    }
  }

  function isOwner(){
    return !!(currentUser && currentOwnerId && currentUser.id === currentOwnerId);
  }

  function updateEditLinkVisibility(){
    if(currentEventId && currentUser && (isOwner() || (eventSaved && currentMemberCanEdit))){
      editEventLink.href = '/e/' + currentEventId + '/editar';
      editEventLink.hidden = false;
    } else {
      editEventLink.hidden = true;
    }
  }

  function refreshNotesEditability(){
    const canEdit = isOwner() || currentMemberCanEdit;
    notesBox.readOnly = !canEdit;
    notesBox.classList.toggle('readonly', !canEdit);
    notesStatus.hidden = !canEdit;
  }

  function setSaveButtonState(saved, canEdit){
    eventSaved = saved;
    currentMemberCanEdit = saved && !!canEdit;
    saveEventBtn.textContent = saved ? 'Remover dos meus eventos' : 'Salvar nos meus eventos';
    updateEditLinkVisibility();
    refreshNotesEditability();
  }

  // ---------- bloco de notas compartilhado ----------
  // Mesmo racional da fila offline de progresso: campo é usado ao vivo, em
  // rede instável. Mas notas não são um log de ações ordenadas — é só "o
  // valor da caixa venceu" — então não precisa de fila persistente (IndexedDB),
  // basta um flag de "ainda não confirmado" e tentar de novo quando a conexão
  // voltar, ou ao esconder/fechar a aba (sync via `keepalive`, com o token em
  // cache pra não depender de um await antes do fetch sair).

  let notesSaveTimer = null;
  let notesDirty = false;

  async function saveNotesNow(opts){
    if(!currentEventId) return;
    const keepalive = !!(opts && opts.keepalive);
    const token = keepalive ? cachedAccessToken : await accessToken();
    if(!token){
      notesDirty = true;
      notesStatus.textContent = 'Não salvou (sessão expirada). Faça login de novo.';
      return;
    }
    try {
      const resp = await fetch('/api/events/' + currentEventId + '/notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ notes: notesBox.value }),
        keepalive
      });
      if(!resp.ok){
        const result = await resp.json().catch(() => ({}));
        throw new Error(result.error || 'Erro ao salvar as notas.');
      }
      notesDirty = false;
      notesStatus.textContent = 'Salvo';
      setTimeout(() => { if(notesStatus.textContent === 'Salvo') notesStatus.textContent = ''; }, 2000);
    } catch(err){
      notesDirty = true;
      notesStatus.textContent = 'Não salvou. Tenta de novo quando a conexão voltar.';
    }
  }

  notesBox.addEventListener('input', function(){
    updateNotesPreview();
    notesDirty = true;
    notesStatus.textContent = 'Salvando…';
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(() => saveNotesNow(), 900);
  });

  window.addEventListener('online', function(){
    if(notesDirty) saveNotesNow();
  });

  function flushNotesIfDirty(){
    if(!notesDirty) return;
    clearTimeout(notesSaveTimer);
    saveNotesNow({ keepalive: true });
  }

  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden') flushNotesIfDirty();
  });
  window.addEventListener('pagehide', flushNotesIfDirty);

  // Entrar na equipe sozinho só é possível por link de colaboração (ou pelo
  // endereço antigo durante a transição). Quem já é da equipe pode sair.
  function canJoinByLink(){
    return currentAccess.shareMode === 'collab' && (currentAccess.via === 'token' || currentAccess.basis === 'legacy');
  }

  async function refreshSaveButton(){
    const eligible = currentEventId && currentUser && !isOwner() && (!!currentAccess.role || canJoinByLink());
    if(!eligible){
      saveEventBtn.hidden = true;
      return;
    }
    saveEventBtn.hidden = false;
    try {
      const token = await accessToken();
      if(!token) { saveEventBtn.hidden = true; return; }
      const resp = await fetch('/api/events/' + currentEventId + '/save', { headers: { Authorization: 'Bearer ' + token } });
      const result = await resp.json();
      if(!resp.ok) throw new Error(result.error || 'Erro.');
      setSaveButtonState(!!result.saved, result.can_edit);
    } catch(err){
      saveEventBtn.hidden = true;
    }
  }

  saveEventBtn.addEventListener('click', async function(){
    saveEventBtn.disabled = true;
    try {
      const token = await accessToken();
      if(!token) throw new Error('Sessão expirada. Faça login de novo.');
      const method = eventSaved ? 'DELETE' : 'POST';
      const url = (!eventSaved && currentAccess.via === 'token')
        ? '/api/share/' + encodeURIComponent(currentAccess.token) + '/join'
        : '/api/events/' + currentEventId + '/save';
      const resp = await fetch(url, { method, headers: { Authorization: 'Bearer ' + token } });
      const result = await resp.json();
      if(!resp.ok) throw new Error(result.error || 'Erro ao salvar.');
      setSaveButtonState(result.saved, result.can_edit);
      // entrar ou sair da equipe muda o que este aparelho pode fazer
      resyncProgress();
    } catch(err){
      alert('Não consegui atualizar (' + (err.message || 'erro desconhecido') + ').');
    } finally {
      saveEventBtn.disabled = false;
    }
  });

  // ---------- gerenciar equipe (permissão por pessoa) ----------

  function refreshManageMembersButton(){
    manageMembersBtn.hidden = !(currentEventId && isOwner());
  }

  function memberRowHTML(member){
    const date = new Date(member.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
    return (
      '<div class="history-card">'+
        '<div>'+
          '<div class="history-title">'+escapeHTML(member.email || 'Email indisponível')+'</div>'+
          '<div class="history-meta">salvou em '+date+'</div>'+
        '</div>'+
        '<div class="history-actions">'+
          '<select class="field-select" data-user-id="'+escapeAttr(member.user_id)+'">'+
            '<option value="viewer"'+(member.can_edit ? '' : ' selected')+'>Visualizador</option>'+
            '<option value="editor"'+(member.can_edit ? ' selected' : '')+'>Editor</option>'+
          '</select>'+
        '</div>'+
      '</div>'
    );
  }

  async function showMembersView(){
    showView('members');
    membersList.innerHTML = '<div class="history-empty">Carregando…</div>';
    try {
      const token = await accessToken();
      if(!token) throw new Error('Sessão expirada. Faça login de novo.');
      const resp = await fetch('/api/events/' + currentEventId + '/members', { headers: { Authorization: 'Bearer ' + token } });
      const result = await resp.json();
      if(!resp.ok) throw new Error(result.error || 'Erro ao carregar a equipe.');
      const members = result.members || [];
      membersList.innerHTML = members.length
        ? members.map(memberRowHTML).join('')
        : '<div class="history-empty">Ninguém na equipe ainda.</div>';
    } catch(err){
      membersList.innerHTML = '<div class="history-empty">Não consegui carregar a equipe (' + escapeHTML(err.message || 'erro') + ').</div>';
    }
    renderMembersInvites();
  }

  manageMembersBtn.addEventListener('click', function(){
    addMemberEmailInput.value = '';
    addMemberStatus.textContent = '';
    showMembersView();
  });
  membersBackBtn.addEventListener('click', function(){ showView('app'); });

  addMemberBtn.addEventListener('click', async function(){
    const email = addMemberEmailInput.value.trim();
    if(!email){ addMemberStatus.textContent = 'Digite um email.'; return; }
    addMemberStatus.textContent = 'Adicionando…';
    addMemberBtn.disabled = true;
    try {
      const token = await accessToken();
      if(!token) throw new Error('Sessão expirada. Faça login de novo.');
      const resp = await fetch('/api/events/' + currentEventId + '/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ email })
      });
      const result = await resp.json();
      if(!resp.ok) throw new Error(result.error || 'Erro ao adicionar.');
      const messages = {
        invited: 'Convite enviado por email.',
        added: 'Adicionado à equipe.',
        existing: 'Essa pessoa já está na equipe.',
        pending: 'Convite registrado. O envio termina em instantes.',
        failed: 'Não foi possível convidar: ' + (result.error || 'erro no envio') + ' Você pode reenviar mais abaixo.'
      };
      addMemberStatus.textContent = messages[result.status] || 'Pedido registrado.';
      addMemberEmailInput.value = '';
      showMembersView();
    } catch(err){
      addMemberStatus.textContent = 'Não consegui adicionar (' + (err.message || 'erro desconhecido') + ').';
    } finally {
      addMemberBtn.disabled = false;
    }
  });

  goToNotesBtn.addEventListener('click', goToNotes);

  membersList.addEventListener('change', async function(e){
    const select = e.target.closest('select[data-user-id]');
    if(!select) return;
    const userId = select.dataset.userId;
    const canEdit = select.value === 'editor';
    select.disabled = true;
    try {
      const token = await accessToken();
      if(!token) throw new Error('Sessão expirada. Faça login de novo.');
      const resp = await fetch('/api/events/' + currentEventId + '/members/' + userId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ can_edit: canEdit })
      });
      const result = await resp.json();
      if(!resp.ok) throw new Error(result.error || 'Erro ao atualizar.');
    } catch(err){
      alert('Não consegui atualizar essa permissão (' + (err.message || 'erro desconhecido') + ').');
      select.value = canEdit ? 'viewer' : 'editor';
    } finally {
      select.disabled = false;
    }
  });

  let googleCalendarConnected = false;
  const calendarPermissionStatus = document.getElementById('calendarPermissionStatus');
  const calendarPermissionsList = document.getElementById('calendarPermissionsList');
  const calendarPermissionsCount = document.getElementById('calendarPermissionsCount');
  const historyLoading = document.getElementById('historyLoading');
  const historyContent = document.getElementById('historyContent');
  async function refreshCalendarPermissions(){
    calendarPermissionsList.replaceChildren();
    try {
      const token = await accessToken();
      const resp = await fetch('/api/google/permissions', { headers: { Authorization: 'Bearer ' + token } });
      const result = await resp.json();
      if(!resp.ok) throw new Error(result.error);
      calendarPermissionsList.innerHTML = result.permissions.length ? result.permissions.map(p =>
        '<div class="calendar-permission-row"><span>' + escapeHTML(p.email || p.organizer_id) + '</span>' +
        '<button class="btn" type="button" data-revoke-organizer="' + escapeHTML(p.organizer_id) + '">Revogar</button></div>'
      ).join('') : '<p>Nenhuma pessoa autorizada.</p>';
      const n = result.permissions.length;
      calendarPermissionsCount.textContent = n ? pluralize(n, 'pessoa autorizada', 'pessoas autorizadas') : 'Ninguém autorizado';
      calendarPermissionsCount.classList.toggle('has-people', n > 0);
    } catch(err){
      calendarPermissionsCount.textContent = '';
      calendarPermissionStatus.textContent = err.message || 'Não foi possível carregar as autorizações.';
    }
  }
  document.getElementById('calendarPermissionForm').addEventListener('submit', async function(e){
    e.preventDefault();
    const button = document.getElementById('calendarAuthorizeBtn');
    button.disabled = true;
    calendarPermissionStatus.textContent = 'Salvando autorização…';
    try {
      const token = await accessToken();
      const resp = await fetch('/api/google/permissions', { method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('calendarOrganizerEmail').value.trim() }) });
      const result = await resp.json();
      if(!resp.ok) throw new Error(result.error);
      this.reset();
      calendarPermissionStatus.textContent = 'Pessoa autorizada. Os eventos da equipe serão sincronizados automaticamente.';
      await refreshCalendarPermissions();
    } catch(err){ calendarPermissionStatus.textContent = err.message || 'Não foi possível autorizar.'; }
    finally { button.disabled = false; }
  });
  calendarPermissionsList.addEventListener('click', async function(e){
    const button = e.target.closest('[data-revoke-organizer]');
    if(!button) return;
    button.disabled = true;
    try {
      const token = await accessToken();
      const resp = await fetch('/api/google/permissions/' + encodeURIComponent(button.dataset.revokeOrganizer), {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      const result = await resp.json();
      if(!resp.ok) throw new Error(result.error);
      calendarPermissionStatus.textContent = 'Autorização revogada. Os eventos existentes permanecem na sua agenda.';
      await refreshCalendarPermissions();
    } catch(err){ calendarPermissionStatus.textContent = err.message || 'Não foi possível revogar.'; button.disabled = false; }
  });

  // Estado da conexão com o Google: botão e textos de "Minha conta" e a
  // linha de estado na seção Google da tela de edição.
  async function fetchGoogleStatus(){
    const token = await accessToken();
    if(!token) return null;
    const resp = await fetch('/api/google/status', { headers: { Authorization: 'Bearer ' + token } });
    const result = await resp.json();
    if(!resp.ok) throw new Error();
    return result;
  }

  function renderGoogleConnectButton(){
    googleCalendarConnectBtn.innerHTML = googleCalendarConnected
      ? icon('x')+'Desconectar Google'
      : icon('link')+'Conectar Google';
  }

  async function refreshGoogleCalendarButton(){
    const status = document.getElementById('googleAccountStatus');
    if(!currentUser){
      googleCalendarConnectBtn.hidden = true;
      googleTestingNote.hidden = true;
      return;
    }
    try {
      const result = await fetchGoogleStatus();
      if(!result){ googleCalendarConnectBtn.hidden = true; googleTestingNote.hidden = true; return; }
      googleCalendarConnected = !!result.connected;
      googleCalendarConnectBtn.hidden = false;
      renderGoogleConnectButton();
      status.textContent = googleCalendarConnected
        ? 'Conectado' + (result.email ? ' como ' + result.email : '') + '.'
        : 'Não conectado.';
      status.classList.toggle('is-on', googleCalendarConnected);
      // só mostra o aviso de "app não verificado" pra quem ainda não conectou:
      // depois de conectado, já deu certo, não faz sentido continuar avisando
      googleTestingNote.hidden = googleCalendarConnected;
    } catch(err){
      googleCalendarConnectBtn.hidden = true;
      googleTestingNote.hidden = true;
      status.textContent = 'Não foi possível verificar a conexão com o Google.';
    }
  }

  // Na tela de edição, a seção Google diz se a conexão existe (convites e
  // pastas dependem dela). O link abre "Minha conta" em outra aba pra não
  // perder o rascunho.
  async function refreshPreviewGoogleStatus(){
    const el = document.getElementById('previewGoogleStatus');
    if(!currentUser){ el.hidden = true; return; }
    try {
      const result = await fetchGoogleStatus();
      if(!result){ el.hidden = true; return; }
      el.classList.toggle('is-on', !!result.connected);
      el.innerHTML = result.connected
        ? 'Google conectado' + (result.email ? ' como ' + escapeHTML(result.email) : '') + '. Convites e pastas funcionam.'
        : 'Google não conectado: convites da agenda e pastas do Drive precisam da conexão. <a href="/conta" target="_blank" rel="noopener">Conectar em Minha conta</a>';
      el.hidden = false;
    } catch(err){ el.hidden = true; }
  }

  googleCalendarConnectBtn.addEventListener('click', async function(){
    googleCalendarConnectBtn.disabled = true;
    try {
      const token = await accessToken();
      if(!token) throw new Error('Sessão expirada. Faça login de novo.');
      if(googleCalendarConnected){
        if(!confirm('Desconectar sua conta do Google? Os eventos já criados na sua agenda e as pastas já criadas no Drive continuam lá, mas deixam de ser atualizados automaticamente.')) return;
        const resp = await fetch('/api/google/disconnect', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
        if(!resp.ok) throw new Error('Erro ao desconectar.');
        googleCalendarConnected = false;
        refreshGoogleCalendarButton();
      } else {
        const resp = await fetch('/api/google/connect', { headers: { Authorization: 'Bearer ' + token } });
        const result = await resp.json();
        if(!resp.ok) throw new Error(result.error || 'Erro ao conectar.');
        window.location.href = result.url;
      }
    } catch(err){
      alert('Não consegui atualizar (' + (err.message || 'erro desconhecido') + ').');
    } finally {
      googleCalendarConnectBtn.disabled = false;
    }
  });

  function hideEventLink(){
    document.getElementById('eventLinkRow').hidden = true;
    calendarLinkBtn.hidden = true;
    driveFolderLinkBtn.hidden = true;
    saveEventBtn.hidden = true;
    manageMembersBtn.hidden = true;
    eventSaved = false;
    currentMemberCanEdit = false;
    currentDriveFolderId = null;
    currentEventDate = '';
    currentEventEndDate = '';
    currentEventLocation = '';
    notesBox.value = '';
    updateNotesPreview();
    notesStatus.textContent = '';
    clearTimeout(notesSaveTimer);
    notesDirty = false;
    eventLinkHint.textContent = '';
    hidePublishSummary();
    refreshNotesEditability();
  }

  // ---------- fila offline de progresso (IndexedDB) ----------
  // Sem isso, uma ação feita sem sinal (comum em campo) era perdida de vez —
  // o fetch falhava e o .catch(()=>{}) engolia o erro. Agora toda ação primeiro
  // entra numa fila local e só sai dela quando o servidor confirma o salvamento.

  const OFFLINE_DB_NAME = 'captura-offline';
  const OFFLINE_STORE = 'progress_queue';

  function openOfflineDB(){
    return new Promise((resolve, reject) => {
      if(!('indexedDB' in window)){ reject(new Error('IndexedDB indisponível')); return; }
      const req = indexedDB.open(OFFLINE_DB_NAME, 1);
      req.onupgradeneeded = function(){
        const db = req.result;
        if(!db.objectStoreNames.contains(OFFLINE_STORE)){
          db.createObjectStore(OFFLINE_STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    });
  }

  // Cada ação guarda por onde deve ser enviada: pelo link (/s/<token>) ou
  // pelo endereço do evento (equipe logada ou link antigo).
  function currentProgressRoute(){
    if(currentAccess.via === 'token' && currentAccess.token) return { kind: 'token', key: currentAccess.token };
    return { kind: 'id', key: currentEventId, auth: !!currentAccess.role };
  }

  async function enqueueProgress(eventId, action, payload, route){
    try {
      const db = await openOfflineDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, 'readwrite');
        tx.objectStore(OFFLINE_STORE).add({ eventId, action, payload, route, ts: Date.now() });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch(err){
      // sem IndexedDB (aba anônima antiga, navegador incomum): último recurso,
      // tenta mandar direto sem fila.
      postProgress({ eventId, action, payload, route }).catch(function(){});
    }
  }

  async function readOfflineQueue(){
    try {
      const db = await openOfflineDB();
      const items = await new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, 'readonly');
        const req = tx.objectStore(OFFLINE_STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return items;
    } catch(err){
      return [];
    }
  }

  async function removeFromOfflineQueue(id){
    try {
      const db = await openOfflineDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, 'readwrite');
        tx.objectStore(OFFLINE_STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch(err){}
  }

  // Itens antigos (antes do controle de acesso) não têm rota: vão pelo
  // endereço do evento, com login se houver.
  async function postProgress(item){
    const route = item.route || { kind: 'id', key: item.eventId, auth: true };
    const url = route.kind === 'token'
      ? '/api/share/' + encodeURIComponent(route.key) + '/progress'
      : '/api/events/' + encodeURIComponent(route.key) + '/progress';
    const headers = { 'Content-Type': 'application/json' };
    if(route.kind === 'id' && route.auth){
      const token = await accessToken().catch(() => null);
      if(token) headers.Authorization = 'Bearer ' + token;
    }
    return fetch(url, { method: 'POST', headers, body: JSON.stringify({ action: item.action, payload: item.payload }) });
  }

  let flushingOfflineQueue = false;
  let droppedProgressCount = 0;
  let droppedInvalidCount = 0; // recusadas por formato inválido (tela desatualizada), não por acesso

  async function flushProgressQueue(){
    if(flushingOfflineQueue) return;
    flushingOfflineQueue = true;
    try {
      const items = (await readOfflineQueue()).sort((a, b) => a.id - b.id);
      for(const item of items){
        let resp;
        try {
          resp = await postProgress(item);
        } catch(err){
          break; // sem conexão: tenta de novo depois, mantendo a ordem original
        }
        if(resp.ok){
          await removeFromOfflineQueue(item.id);
          continue;
        }
        // Recusa definitiva (link revogado, modo mudou, evento excluído,
        // ação malformada): nunca vai passar, então sai da fila em vez de
        // travar as ações seguintes. 401/5xx/429 podem passar depois.
        if([400, 403, 404, 410].includes(resp.status)){
          const body = await resp.json().catch(() => ({}));
          if(body && body.code === 'invalid_payload') droppedInvalidCount++;
          await removeFromOfflineQueue(item.id);
          droppedProgressCount++;
          continue;
        }
        break;
      }
    } finally {
      flushingOfflineQueue = false;
      updateSyncStatus();
    }
  }

  async function updateSyncStatus(){
    const el = document.getElementById('syncStatus');
    const textEl = document.getElementById('syncStatusText');
    if(!el) return;
    const count = (await readOfflineQueue()).length;
    if(count === 0 && droppedProgressCount > 0){
      el.hidden = false;
      el.classList.add('sync-status--offline');
      const onlyInvalid = droppedInvalidCount === droppedProgressCount;
      textEl.textContent = droppedProgressCount + (droppedProgressCount === 1 ? ' ação não foi salva' : ' ações não foram salvas') +
        (onlyInvalid ? ': o servidor recusou os dados (atualize a página)' : ': o acesso a este evento mudou');
      return;
    }
    if(count === 0){
      el.hidden = true;
      el.classList.remove('sync-status--offline');
      return;
    }
    el.hidden = false;
    const offline = !navigator.onLine;
    el.classList.toggle('sync-status--offline', offline);
    textEl.textContent = offline
      ? (count + (count === 1 ? ' ação sem conexão' : ' ações sem conexão'))
      : ('sincronizando ' + count + '…');
  }

  window.addEventListener('online', function(){ updateSyncStatus(); flushProgressQueue(); });
  window.addEventListener('offline', function(){ updateSyncStatus(); });
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) flushProgressQueue(); });
  setInterval(flushProgressQueue, 30000);

  // ---------- progresso em tempo real ----------

  function sendProgress(action, payload){
    if(!currentEventId || !currentAccess.canWriteProgress) return;
    enqueueProgress(currentEventId, action, payload, currentProgressRoute()).then(function(){
      updateSyncStatus();
      flushProgressQueue();
    });
  }

  // EventSource não manda cabeçalho de login: a equipe pede um ticket curto
  // e usa na URL. Quem entrou por link conecta pelo próprio link.
  async function streamUrl(){
    if(currentAccess.via === 'token' && currentAccess.token) return '/api/share/' + encodeURIComponent(currentAccess.token) + '/stream';
    if(currentAccess.role){
      const token = await accessToken().catch(() => null);
      if(token){
        const resp = await fetch('/api/events/' + encodeURIComponent(currentEventId) + '/stream-ticket', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
        const result = await resp.json().catch(() => ({}));
        if(resp.ok && result.ticket) return '/api/events/' + encodeURIComponent(currentEventId) + '/stream?ticket=' + encodeURIComponent(result.ticket);
      }
    }
    return '/api/events/' + encodeURIComponent(currentEventId) + '/stream';
  }

  async function connectProgressStream(){
    clearTimeout(streamRetryTimer);
    if(progressStream){ progressStream.close(); progressStream = null; }
    const eventId = currentEventId;
    if(!eventId) return;
    let url;
    try { url = await streamUrl(); } catch(err){ url = null; }
    if(!url || currentEventId !== eventId) return;
    streamHadError = false;
    const stream = new EventSource(url);
    progressStream = stream;
    stream.onmessage = function(e){
      let msg;
      try { msg = JSON.parse(e.data); } catch(err){ return; }
      handleRemoteProgress(msg);
    };
    stream.onerror = function(){
      streamHadError = true;
      // conexão recusada (ticket vencido, link revogado): o navegador não
      // tenta de novo sozinho, então reabre com um ticket novo, com espera
      // crescente pra não martelar o servidor.
      if(stream.readyState === 2 && progressStream === stream){
        streamRetryTimer = setTimeout(function(){
          if(currentEventId === eventId) connectProgressStream().then(() => resyncProgress());
        }, streamRetryDelay);
        streamRetryDelay = Math.min(streamRetryDelay * 2, 60000);
      }
    };
    stream.onopen = function(){
      streamRetryDelay = 3000;
      if(streamHadError){
        streamHadError = false;
        resyncProgress();
      }
    };
  }

  function disconnectProgressStream(){
    clearTimeout(streamRetryTimer);
    if(progressStream){ progressStream.close(); progressStream = null; }
    currentEventId = null;
  }

  function handleRemoteProgress(msg){
    const action = msg.action;
    const payload = msg.payload || {};
    if(action === 'status') applyStatus(payload.sceneId, { status: payload.status, andamentoAt: payload.andamentoAt, feitoAt: payload.feitoAt, postadoAt: payload.postadoAt });
    else if(action === 'record') applyStatus(payload.sceneId, { status: 'feito', feitoAt: payload.time });
    else if(action === 'unrecord') applyStatus(payload.sceneId, null);
    else if(action === 'mission') applyMissionKey(payload.cat + '-' + (payload.itemKey ?? payload.idx), true);
    else if(action === 'unmission') applyMissionKey(payload.cat + '-' + (payload.itemKey ?? payload.idx), false);
    else if(action === 'reset'){
      resetAllProgress();
      // quem reiniciou já viu o próprio aviso (com o "Desfazer")
      if(Date.now() - lastLocalResetAt > 10000) showToast('O checklist foi reiniciado por alguém da equipe.', { ms: 8000 });
    }
    else if(action === 'access_changed'){
      // o dono mudou o compartilhamento: confere de novo se este aparelho ainda tem acesso
      if(progressStream){ progressStream.close(); progressStream = null; }
      resyncProgress({ reconnect: true });
    }
    else if(action === 'notes'){
      // não sobrescreve se a pessoa estiver digitando ali agora, ou se já tem uma
      // edição local pendente de salvar — a atualização dela mesma vai chegar
      // (e prevalecer) quando o debounce/retry dela salvar
      if(document.activeElement !== notesBox && !notesDirty){ notesBox.value = payload.notes; updateNotesPreview(); }
    }
  }

  function eventApiUrl(kind, key){
    return kind === 'token' ? '/api/share/' + encodeURIComponent(key) : '/api/events/' + encodeURIComponent(key);
  }

  // Busca o evento mandando o login quando houver (a equipe abre pelo
  // endereço /e/<id>; visitantes pelo link). Offline, o service worker
  // devolve a última cópia salva.
  async function fetchEventData(kind, key){
    const headers = {};
    const token = sb ? await withTimeout(accessToken(), 4000).catch(() => null) : null;
    if(token) headers.Authorization = 'Bearer ' + token;
    const resp = await fetch(eventApiUrl(kind, key), { headers });
    const data = await resp.json().catch(() => ({}));
    return { resp, data };
  }

  function resyncProgress(opts){
    const reconnect = !!(opts && opts.reconnect);
    const kind = currentAccess.via === 'token' ? 'token' : 'id';
    const key = kind === 'token' ? currentAccess.token : currentEventId;
    if(!key) return Promise.resolve();
    return fetchEventData(kind, key).then(function(result){
      const resp = result.resp, data = result.data;
      if(!resp.ok){
        if(resp.status === 403 || resp.status === 404) showAccessDenied(data, kind);
        return;
      }
      setAccess(accessFromData(data, kind, currentAccess.token));
      applyReadOnlyState();
      if(data.progress){
        resetAllProgress();
        Object.entries(data.progress.recorded || {}).forEach(([sceneId, entry]) => applyStatus(sceneId, entry));
        Object.entries(data.progress.missionsDone || {}).forEach(([missionKey, done]) => { if(done) applyMissionKey(missionKey, true); });
      }
      if(document.activeElement !== notesBox && !notesDirty){ notesBox.value = data.notes || ''; updateNotesPreview(); }
      if(reconnect && data.id){
        showEventLink(data.id);
        refreshSaveButton();
      }
    }).catch(function(){});
  }

  document.getElementById('copyLinkBtn').addEventListener('click', function(){
    copyInputValue(document.getElementById('eventLinkInput'), this);
  });

  function copyInputValue(input, btn){
    const done = () => {
      const original = btn.textContent;
      btn.textContent = 'Copiado!';
      setTimeout(() => { btn.textContent = original; }, 1500);
    };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(input.value).then(done).catch(() => {
        input.select();
        document.execCommand('copy');
        done();
      });
    } else {
      input.select();
      document.execCommand('copy');
      done();
    }
  }

  // ---------- acesso negado / link revogado ----------

  function showAccessDenied(data, kind){
    const code = data && data.code;
    const title = document.getElementById('accessTitle');
    const message = document.getElementById('accessMessage');
    const loginBtn = document.getElementById('accessLoginBtn');
    disconnectProgressStream();
    forgetOfflineEvent(window.location.pathname);
    if(code === 'link_invalid' || (kind === 'token' && !code)){
      title.textContent = 'Este link não funciona mais';
      message.textContent = (data && data.error) || 'O link foi desativado ou substituído. Peça o link atualizado a quem organiza o evento.';
      loginBtn.hidden = true;
    } else if(code === 'not_found'){
      title.textContent = 'Evento não encontrado';
      message.textContent = 'O link pode estar incompleto ou o evento foi excluído. Confira o link com quem organiza o evento.';
      loginBtn.hidden = true;
    } else {
      title.textContent = 'Este evento é restrito à equipe';
      message.textContent = currentUser
        ? 'Sua conta (' + (currentUser.email || '') + ') não faz parte da equipe deste evento. Peça ao dono pra te adicionar, ou peça o link de compartilhamento.'
        : 'Entre com a conta que foi adicionada à equipe, ou peça o link de compartilhamento a quem organiza o evento.';
      loginBtn.hidden = !!currentUser;
    }
    document.getElementById('accessHistoryLink').hidden = !currentUser;
    showView('access');
  }

  document.getElementById('accessLoginBtn').addEventListener('click', function(){
    localStorage.setItem(RETURN_TO_KEY, window.location.pathname);
    showLogin('team');
  });

  document.getElementById('accessHomeBtn').addEventListener('click', function(){
    backToImport();
  });

  // ---------- eventos disponíveis offline ----------

  function readOfflineEvents(){
    try {
      const list = JSON.parse(localStorage.getItem(OFFLINE_EVENTS_KEY) || '[]');
      return Array.isArray(list) ? list.filter(e => e && typeof e.path === 'string') : [];
    } catch(err){ return []; }
  }

  function rememberOfflineEvent(path, title){
    const list = readOfflineEvents().filter(e => e.path !== path);
    list.unshift({ path, title: title || 'Evento', at: Date.now() });
    try { localStorage.setItem(OFFLINE_EVENTS_KEY, JSON.stringify(list.slice(0, 12))); } catch(err){}
  }

  function forgetOfflineEvent(path){
    const list = readOfflineEvents().filter(e => e.path !== path);
    try { localStorage.setItem(OFFLINE_EVENTS_KEY, JSON.stringify(list)); } catch(err){}
  }

  function apiPathForPage(path){
    let m;
    if((m = path.match(/^\/s\/([A-Za-z0-9_-]+)$/))) return eventApiUrl('token', m[1]);
    if((m = path.match(/^\/e\/([a-zA-Z0-9-]+)$/))) return eventApiUrl('id', m[1]);
    return null;
  }

  // Só lista o que o service worker realmente tem salvo neste aparelho.
  async function availableOfflineEvents(){
    if(typeof caches === 'undefined') return [];
    const result = [];
    for(const entry of readOfflineEvents()){
      const api = apiPathForPage(entry.path);
      if(api && await caches.match(api).catch(() => null)) result.push(entry);
    }
    return result;
  }

  // ---------- carregar evento ----------

  async function loadEventFromUrl(id){
    return loadEventVia('id', id);
  }

  async function loadEventFromShare(token){
    return loadEventVia('token', token);
  }

  async function loadEventVia(kind, key){
    try {
      const { resp, data } = await fetchEventData(kind, key);
      if(resp.status === 403 || resp.status === 404) return showAccessDenied(data, kind);
      if(!resp.ok){
        throw new Error(data.error || 'Evento não encontrado.');
      }
      setAccess(accessFromData(data, kind, kind === 'token' ? key : null));
      currentOwnerId = data.owner_id || null;
      currentDriveFolderId = data.drive_folder_id || null;
      currentShare = null;
      loadChecklist(data);
      const eventId = data.id || key;
      showEventLink(eventId);
      rememberOfflineEvent(window.location.pathname, data.event_title);
      if(currentAccess.role === 'owner') refreshCurrentShare(eventId);
    } catch(err){
      importError.textContent = err.message || 'Não consegui carregar esse evento.';
      importError.hidden = false;
      showView('import');
      history.pushState({}, '', '/');
    }
  }

  // O dono vê o link de compartilhamento na tela do evento.
  async function refreshCurrentShare(eventId){
    try {
      const token = await accessToken();
      if(!token) return;
      const resp = await fetch('/api/events/' + encodeURIComponent(eventId) + '/share', { headers: { Authorization: 'Bearer ' + token } });
      if(!resp.ok) return;
      currentShare = await resp.json();
      if(currentEventId === eventId){
        const info = eventLinkFor(eventId);
        document.getElementById('eventLinkInput').value = info.link;
        document.getElementById('eventLinkLabel').textContent = info.label;
        eventLinkHint.textContent = info.hint;
      }
    } catch(err){}
  }

  async function loadEventForEdit(id){
    generatedInPreview = false;
    roteiroSource = null;
    try {
      const { resp, data } = await fetchEventData('id', id);
      if(resp.status === 403 || resp.status === 404) return showAccessDenied(data, 'id');
      if(!resp.ok){
        throw new Error(data.error || 'Evento não encontrado.');
      }
      draft = normalizeDraft(data);
      editingEventId = id;
      editingRevision = Number.isInteger(data.revision) ? data.revision : null;
      editingLoadedNotes = data.notes || '';
      setAccess(accessFromData(data, 'id', null));
      currentOwnerId = data.owner_id || null;
      currentDriveFolderId = data.drive_folder_id || null;
      editingShare = null;
      draft.share_mode = (data.access && data.access.share_mode) || null;
      restoreConflictDraft(id);
      renderPreviewAll();
      showView('preview');
      publishBtn.textContent = 'Salvar alterações';
      if(currentAccess.role === 'owner') loadEditingShare(id);
    } catch(err){
      importError.textContent = err.message || 'Não consegui carregar esse evento pra editar.';
      importError.hidden = false;
      showView('import');
      history.pushState({}, '', '/');
    }
  }

  // Volta do Google (OAuth) com ?google=conectado.
  function announceGoogleConnected(path){
    if(new URLSearchParams(window.location.search).get('google') !== 'conectado') return;
    history.replaceState({}, '', path);
    alert('Google conectado! A partir de agora, seus eventos com data sincronizam automaticamente com o Calendar, e você já pode criar estruturas de pastas no Drive.');
  }

  // "Minha conta": conexão com o Google, quem pode adicionar eventos à
  // agenda e sair. Abre pelo email na barra de cima.
  async function showAccountView(){
    if(!currentUser){
      localStorage.setItem(RETURN_TO_KEY, '/conta');
      showLogin('account');
      return;
    }
    document.getElementById('accountEmail').textContent = currentUser.email || '';
    calendarPermissionStatus.textContent = '';
    showView('account');
    announceGoogleConnected('/conta');
    await Promise.all([refreshGoogleCalendarButton(), refreshCalendarPermissions()]);
  }

  document.getElementById('accountLogoutBtn').addEventListener('click', function(){
    authStripLogoutBtn.click();
  });

  async function showHistoryView(){
    if(!currentUser){
      showLogin('history');
      return;
    }
    // Esqueleto enquanto carrega; eventos e autorizações aparecem juntos,
    // sem a seção de agenda ocupar a tela sozinha antes da lista.
    historyLoading.hidden = false;
    historyContent.hidden = true;
    historyList.innerHTML = '';
    showView('history');
    refreshGoogleCalendarButton();
    calendarPermissionStatus.textContent = '';
    const permissionsLoaded = refreshCalendarPermissions();
    announceGoogleConnected('/historico');
    try {
      await loadHistoryEvents();
    } finally {
      await permissionsLoaded;
      historyLoading.hidden = true;
      historyContent.hidden = false;
    }
  }

  async function loadHistoryEvents(){
    try {
      const token = await accessToken();
      const resp = await fetch('/api/events', { headers: { Authorization: 'Bearer ' + token } });
      const result = await resp.json();
      if(!resp.ok){
        throw new Error(result.error || 'Erro ao carregar histórico.');
      }
      historyEvents = result.events || [];
      const withDate = historyEvents.filter(ev => ev.event_date);
      calMonthCursor = withDate.length
        ? new Date(withDate.slice().sort((a,b) => new Date(b.event_date) - new Date(a.event_date))[0].event_date)
        : new Date();
      updateHistoryViewSwitch();
      renderHistoryList();
    } catch(err){
      historyList.innerHTML = '<div class="history-empty">Não consegui carregar seu histórico (' + escapeHTML(err.message || 'erro') + ').</div>';
    }
  }

  function updateHistoryViewSwitch(){
    historyViewSwitch.querySelectorAll('.view-switch-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === historyViewMode);
    });
  }

  historyViewSwitch.addEventListener('click', function(e){
    const btn = e.target.closest('.view-switch-btn');
    if(!btn) return;
    historyViewMode = btn.dataset.mode;
    localStorage.setItem(HISTORY_VIEW_KEY, historyViewMode);
    updateHistoryViewSwitch();
    renderHistoryList();
  });

  // Delegado no container (não em cada card) porque a lista inteira é
  // recriada via innerHTML a cada render — um listener por card se perderia.
  historyList.addEventListener('click', async function(e){
    const btn = e.target.closest('[data-action="delete-event"], [data-action="remove-event"]');
    if(!btn) return;
    const id = btn.dataset.id;
    const ev = historyEvents.find(x => x.id === id);
    if(!ev) return;
    const isOwnerDelete = btn.dataset.action === 'delete-event';
    const confirmMsg = isOwnerDelete
      ? 'Excluir "' + ev.event_title + '" permanentemente? Isso apaga o evento e todo o progresso registrado e não pode ser desfeito.'
      : 'Remover "' + ev.event_title + '" da sua lista? Dá pra salvar de novo depois, se ainda tiver o link.';
    if(!confirm(confirmMsg)) return;

    btn.disabled = true;
    try {
      const token = await accessToken();
      const url = isOwnerDelete ? ('/api/events/' + id) : ('/api/events/' + id + '/save');
      const resp = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      const result = await resp.json();
      if(!resp.ok) throw new Error(result.error || 'Erro ao remover.');
      historyEvents = historyEvents.filter(x => x.id !== id);
      renderHistoryList();
    } catch(err){
      alert('Não consegui remover (' + (err.message || 'erro desconhecido') + ').');
      btn.disabled = false;
    }
  });

  function historyCardHTML(ev){
    const date = new Date(ev.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    let meta = ev.scene_count ? (ev.scene_count + ' cenas · publicado em ' + date) : ('Rascunho, sem roteiro ainda · reservado em ' + date);
    if(!ev.is_owner) meta += ev.is_editor ? ' · salvo · pode editar' : ' · salvo, não é seu';
    const editLink = (ev.is_owner || ev.is_editor) ? '<a class="btn btn-primary" href="/e/'+encodeURIComponent(ev.id)+'/editar">Editar</a>' : '';
    const dangerBtn = ev.is_owner
      ? '<button type="button" class="btn btn-danger" data-action="delete-event" data-id="'+escapeAttr(ev.id)+'">Excluir</button>'
      : '<button type="button" class="btn btn-danger" data-action="remove-event" data-id="'+escapeAttr(ev.id)+'">Remover</button>';
    return (
      '<div class="history-card'+(ev.is_owner ? '' : ' history-card--saved')+'">'+
        '<div>'+
          '<div class="history-title">'+escapeHTML(ev.event_title)+'</div>'+
          '<div class="history-meta">'+meta+'</div>'+
        '</div>'+
        '<div class="history-actions">'+
          '<a class="btn" href="/e/'+encodeURIComponent(ev.id)+'">Ver</a>'+
          editLink+
          dangerBtn+
        '</div>'+
      '</div>'
    );
  }

  function renderHistoryList(){
    historyList.classList.remove('grid-mode');
    if(!historyEvents.length){
      historyList.innerHTML = '<div class="history-empty">Você ainda não publicou nenhum roteiro.</div>';
      return;
    }
    if(historyViewMode === 'grid') return renderHistoryAsGrid();
    if(historyViewMode === 'calendar') return renderHistoryAsCalendar();
    renderHistoryAsList();
  }

  function renderHistoryAsList(){
    historyList.innerHTML = historyEvents.map(historyCardHTML).join('');
  }

  function renderHistoryAsGrid(){
    historyList.classList.add('grid-mode');
    historyList.innerHTML = historyEvents.map(historyCardHTML).join('');
  }

  function renderHistoryAsCalendar(){
    const year = calMonthCursor.getFullYear();
    const month = calMonthCursor.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const eventsByDay = {};
    const noDateEvents = [];
    historyEvents.forEach(ev => {
      if(!ev.event_date){ noDateEvents.push(ev); return; }
      const d = new Date(ev.event_date);
      if(d.getFullYear() === year && d.getMonth() === month){
        const day = d.getDate();
        (eventsByDay[day] = eventsByDay[day] || []).push(ev);
      }
    });

    const dayLabels = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    let cellsHTML = dayLabels.map(l => '<div class="cal-day-label">'+l+'</div>').join('');
    for(let i = 0; i < startOffset; i++) cellsHTML += '<div class="cal-cell empty"></div>';
    for(let day = 1; day <= daysInMonth; day++){
      const dayEvents = (eventsByDay[day] || []).map(ev =>
        '<button type="button" class="cal-event" data-id="'+escapeAttr(ev.id)+'" title="'+escapeAttr(ev.event_title)+'">'+escapeHTML(ev.event_title)+'</button>'
      ).join('');
      cellsHTML += '<div class="cal-cell"><span class="cal-date">'+day+'</span>'+dayEvents+'</div>';
    }

    const noDateHTML = noDateEvents.length
      ? '<div class="cal-nodata"><div class="cal-nodata-title">Sem data definida</div>'+noDateEvents.map(historyCardHTML).join('')+'</div>'
      : '';

    historyList.innerHTML =
      '<div class="cal-nav">'+
        '<button class="btn" type="button" id="calPrevBtn">'+icon('arrow-left')+'Mês anterior</button>'+
        '<span class="cal-nav-label">'+firstOfMonth.toLocaleDateString('pt-BR', { month:'long', year:'numeric' })+'</span>'+
        '<button class="btn" type="button" id="calNextBtn">Próximo mês'+icon('arrow-right')+'</button>'+
      '</div>'+
      '<div class="cal-grid">'+cellsHTML+'</div>'+
      noDateHTML;

    document.getElementById('calPrevBtn').addEventListener('click', function(){
      calMonthCursor = new Date(year, month - 1, 1);
      renderHistoryAsCalendar();
    });
    document.getElementById('calNextBtn').addEventListener('click', function(){
      calMonthCursor = new Date(year, month + 1, 1);
      renderHistoryAsCalendar();
    });
    historyList.querySelectorAll('.cal-event').forEach(btn => {
      btn.addEventListener('click', function(){
        window.location.href = '/e/' + encodeURIComponent(btn.dataset.id);
      });
    });
  }

  function render(){
    const container = document.getElementById('phasesContainer');
    const nav = document.getElementById('phaseNav');
    let mainHTML = '';
    let navHTML = '';

    PHASES.forEach(phase=>{
      const items = CONTENT.filter(c=>c.phase===phase.key);
      if(!items.length) return;
      mainHTML +=
        '<section class="phase" id="'+phase.key+'">'+
          '<div class="phase-header">'+
            '<div class="phase-icon">'+icon(phase.icon)+'</div>'+
            '<div class="phase-titles">'+
              '<h2 class="phase-name" id="phase-title-'+phase.key+'" tabindex="-1">'+escapeHTML(phase.label)+'</h2>'+
            '</div>'+
            '<span class="phase-done-badge">Concluída</span>'+
            '<div class="phase-count" id="phasecount-'+phase.key+'">0 / '+items.length+'</div>'+
          '</div>'+
          '<div class="cards-grid">'+ items.map(cardHTML).join('') +'</div>'+
        '</section>';

      navHTML +=
        '<a class="phase-pill" id="pill-'+phase.key+'" href="#'+phase.key+'">'+
          icon(phase.icon)+'<span>'+escapeHTML(phase.label)+'</span> <b id="pillcount-'+phase.key+'">0/'+items.length+'</b>'+
        '</a>';
    });

    container.innerHTML = CONTENT.length ? mainHTML : '<div class="history-empty">Este evento ainda não tem roteiro. Volte aqui assim que a equipe adicionar.</div>';
    nav.innerHTML = navHTML;
    document.getElementById('totalCount').textContent = CONTENT.length;
    observePhases();
  }

  function renderMissions(){
    const section = document.getElementById('missionsSection');
    const grid = document.getElementById('missionsGrid');
    if(!MISSIONS.length){
      section.hidden = true;
      grid.innerHTML = '';
      return;
    }
    section.hidden = false;
    grid.innerHTML = MISSIONS.map(cat=>{
      const chips = cat.items.map((item)=>
        '<button type="button" class="mission-chip" data-cat="'+escapeAttr(cat.key)+'" data-item-key="'+escapeAttr(item.key)+'" data-key="'+escapeAttr(cat.key+'-'+item.key)+'">'+escapeHTML(item.text)+'</button>'
      ).join('');
      return (
        '<div class="mission-cat">'+
          '<div class="mission-cat-head">'+
            '<div class="mission-cat-label">'+escapeHTML(cat.emoji||'')+' '+escapeHTML(cat.label)+'</div>'+
            '<div class="mission-cat-count" id="misscount-'+cat.key+'">0/'+cat.items.length+'</div>'+
          '</div>'+
          '<div class="mission-chips">'+chips+'</div>'+
        '</div>'
      );
    }).join('');
  }

  function isDone(id){
    return !!(recorded[id] && (recorded[id].status === 'feito' || recorded[id].status === 'postado'));
  }

  function updateAll(){
    const doneCount = CONTENT.filter(c => isDone(c.id)).length;
    const total = CONTENT.length;
    const pct = total ? Math.round((doneCount/total)*100) : 0;

    document.getElementById('doneCount').textContent = doneCount;
    document.getElementById('progressPct').textContent = pct+'%';
    document.getElementById('progressFill').style.transform = 'scaleX(' + (pct / 100) + ')';

    PHASES.forEach(phase=>{
      const items = CONTENT.filter(c=>c.phase===phase.key);
      const doneInPhase = items.filter(c=>isDone(c.id)).length;
      const countEl = document.getElementById('phasecount-'+phase.key);
      const pillCountEl = document.getElementById('pillcount-'+phase.key);
      const pillEl = document.getElementById('pill-'+phase.key);
      if(countEl) countEl.innerHTML = '<b>'+doneInPhase+'</b> / '+items.length;
      if(pillCountEl) pillCountEl.textContent = doneInPhase+'/'+items.length;
      if(pillEl) pillEl.classList.toggle('done', doneInPhase===items.length && items.length>0);
    });

    checkCompletion(doneCount, total);
    updateNextSceneButton();
  }

  function updateMissions(){
    MISSIONS.forEach(cat=>{
      let done = 0;
      cat.items.forEach((item)=>{ if(missionsDone[cat.key+'-'+item.key]) done++; });
      const el = document.getElementById('misscount-'+cat.key);
      if(el) el.textContent = done+'/'+cat.items.length;
    });
  }

  function checkCompletion(doneCount, total){
    const banner = document.getElementById('completionBanner');
    if(total>0 && doneCount>0 && doneCount===total){
      const eventName = document.getElementById('eventTitle').textContent || 'o evento';
      document.getElementById('completionSub').textContent = 'Todas as '+total+' cenas de "'+eventName+'" foram capturadas.';
      banner.classList.add('visible');
    } else {
      banner.classList.remove('visible');
    }
  }

  function applyStatus(id, entry){
    const card = document.getElementById('card-'+id);
    const stamp = document.getElementById('stamp-'+id);
    const timesEl = document.getElementById('times-'+id);
    const status = entry && entry.status;

    if(status === 'andamento' || status === 'feito' || status === 'postado'){
      recorded[id] = { status, andamentoAt: entry.andamentoAt || null, feitoAt: entry.feitoAt || null, postadoAt: entry.postadoAt || null };
    } else {
      delete recorded[id];
    }

    if(card){
      card.classList.toggle('is-progress', status === 'andamento');
      card.classList.toggle('is-done', status === 'feito');
      card.classList.toggle('is-posted', status === 'postado');
      // com "só pendentes", uma cena que voltou a ficar pendente reaparece na hora
      if(isPendingStatus(status) && card.classList.contains('is-filtered')) unfilterCard(card, id);
      card.querySelectorAll('.status-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.status === (status || 'nao_iniciado'));
      });
    }
    if(stamp){
      if(status === 'andamento') stamp.textContent = 'EM ANDAMENTO' + (recorded[id].andamentoAt ? ' · '+formatStamp(recorded[id].andamentoAt) : '');
      else if(status === 'feito') stamp.textContent = 'CAPTURADO' + (recorded[id].feitoAt ? ' · '+formatStamp(recorded[id].feitoAt) : '');
      else if(status === 'postado') stamp.textContent = 'POSTADO' + (recorded[id].postadoAt ? ' · '+formatStamp(recorded[id].postadoAt) : '');
      else stamp.textContent = 'CAPTURADO';
    }
    if(timesEl){
      const parts = [];
      if(recorded[id] && recorded[id].andamentoAt) parts.push('Iniciado ' + formatStamp(recorded[id].andamentoAt));
      if(recorded[id] && recorded[id].feitoAt) parts.push('Concluído ' + formatStamp(recorded[id].feitoAt));
      if(recorded[id] && recorded[id].postadoAt) parts.push('Postado ' + formatStamp(recorded[id].postadoAt));
      timesEl.textContent = parts.join(' · ');
    }

    updateAll();
  }

  function applyMissionKey(key, done){
    const chip = document.querySelector('.mission-chip[data-key="'+key+'"]');
    if(done){
      missionsDone[key] = true;
      if(chip) chip.classList.add('done');
    } else {
      delete missionsDone[key];
      if(chip) chip.classList.remove('done');
    }
    updateMissions();
  }

  function resetAllProgress(){
    Object.keys(recorded).forEach(id => applyStatus(id, null));
    Object.keys(missionsDone).forEach(key => applyMissionKey(key, false));
  }

  function setSceneStatus(id, status){
    if(status === 'nao_iniciado'){
      applyStatus(id, null);
      sendProgress('status', { sceneId: id, status: 'nao_iniciado', andamentoAt: null, feitoAt: null, postadoAt: null });
      return;
    }
    // capturado agora, no toque: se a ação ficar na fila offline, o horário
    // continua sendo o do toque, não o da sincronização
    const time = nowStamp();
    const prev = recorded[id] || {};
    const entry = {
      status,
      andamentoAt: status === 'andamento' ? time : (prev.andamentoAt || null),
      feitoAt: status === 'feito' ? time : (prev.feitoAt || null),
      postadoAt: status === 'postado' ? time : (prev.postadoAt || null)
    };
    applyStatus(id, entry);
    sendProgress('status', { sceneId: id, ...entry });
  }

  function toggleMission(cat, itemKey){
    const key = cat+'-'+itemKey;
    if(missionsDone[key]){
      applyMissionKey(key, false);
      sendProgress('unmission', { cat, itemKey });
    } else {
      applyMissionKey(key, true);
      sendProgress('mission', { cat, itemKey });
    }
  }

  document.addEventListener('click', function(e){
    const phasePill = e.target.closest('.phase-pill');
    if(phasePill){
      e.preventDefault();
      const key = phasePill.getAttribute('href').slice(1);
      const target = document.getElementById(key);
      if(target) target.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
      // o foco acompanha a rolagem (leitor de tela e teclado continuam dali)
      const heading = document.getElementById('phase-title-'+key);
      if(heading) heading.focus({ preventScroll: true });
      setCurrentPhasePill(key);
      return;
    }

    const statusBtn = e.target.closest('.status-btn');
    if(statusBtn){
      if(currentAccess.canWriteProgress) setSceneStatus(statusBtn.dataset.id, statusBtn.dataset.status);
      return;
    }

    if(e.target.closest('#createDriveFolderBtn') || e.target.closest('#updateDriveFolderBtn')){ createDriveFolderStructure(); return; }

    const chip = e.target.closest('.mission-chip');
    if(chip){
      if(currentAccess.canWriteProgress) toggleMission(chip.dataset.cat, chip.dataset.itemKey);
      return;
    }

    const structBtn = e.target.closest('[data-action]');
    if(structBtn && draft){
      const action = structBtn.dataset.action;
      const idx = Number(structBtn.dataset.idx);

      if(action === 'remove-phase'){
        const phase = draft.phases[idx];
        const scenesInPhase = draft.scenes.filter(s => s.phase === phase.key);
        if(scenesInPhase.length){
          const ok = confirm('Essa fase tem '+scenesInPhase.length+' cena(s). Remover mesmo assim? As cenas serão movidas para outra fase.');
          if(!ok) return;
        }
        draft.phases.splice(idx, 1);
        if(!draft.phases.length){
          draft.phases.push({ key: 'fase_' + Math.random().toString(36).slice(2, 8), label: 'Fase 1', icon: 'flag' });
        }
        const fallback = draft.phases[Math.max(0, idx - 1)] || draft.phases[0];
        draft.scenes.forEach(s => { if(s.phase === phase.key) s.phase = fallback.key; });
        renderPreviewAll();
      } else if(action === 'move-phase-up' || action === 'move-phase-down'){
        const dir = action === 'move-phase-up' ? -1 : 1;
        const target = idx + dir;
        if(target < 0 || target >= draft.phases.length) return;
        const tmp = draft.phases[idx];
        draft.phases[idx] = draft.phases[target];
        draft.phases[target] = tmp;
        renderPreviewAll();
      } else if(action === 'toggle-scene'){
        toggleScene(structBtn);
      } else if(action === 'toggle-icons'){
        toggleIconGrid(structBtn);
      } else if(action === 'add-scene'){
        const phaseIdx = Number(structBtn.dataset.phaseIdx);
        const phase = draft.phases[phaseIdx];
        const scene = { id: 'cena_' + Math.random().toString(36).slice(2, 8), phase: phase.key, title: 'Nova cena', icon: 'flag', formato: 'Story ao vivo', capture: [], speech: '', can: [], cannot: [] };
        draft.scenes.push(scene);
        // cena nova já abre, com o cursor no título
        openSceneIds.add(scene.id);
        renderPreviewAll();
        const titleInput = document.getElementById('edit-scene-'+(draft.scenes.length - 1)+'-title');
        if(titleInput){ titleInput.focus(); if(titleInput.select) titleInput.select(); }
      } else if(action === 'remove-scene'){
        draft.scenes.splice(idx, 1);
        renderPreviewAll();
      } else if(action === 'move-scene-up'){
        moveSceneWithinPhase(idx, -1);
      } else if(action === 'move-scene-down'){
        moveSceneWithinPhase(idx, 1);
      } else if(action === 'remove-mission-cat'){
        draft.missions.splice(idx, 1);
        renderPreviewMissions();
      }
      return;
    }
  });

  // ---------- checklist ao vivo: topo fixo, menu "Mais", filtro e próxima ----------
  // Em campo, no celular e com uma mão: o topo fica fixo e curto (título,
  // sincronização, progresso, fases), o resto das ações vai pro menu "Mais"
  // e o botão "Próxima" fica na área do polegar.

  const liveTopbar = document.getElementById('liveTopbar');
  const moreMenuBtn = document.getElementById('moreMenuBtn');
  const moreMenu = document.getElementById('moreMenu');
  const pendingFilterBtn = document.getElementById('pendingFilterBtn');
  const nextSceneBtn = document.getElementById('nextSceneBtn');
  const notesPreview = document.getElementById('notesPreview');
  const PENDING_ONLY_PREFIX = 'captura_pending_only:';
  let pendingOnly = false;
  let phaseObserver = null;

  function prefersReducedMotion(){
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function scrollBehavior(){ return prefersReducedMotion() ? 'auto' : 'smooth'; }

  // Altura real do topo fixo, pra rolagens pararem logo abaixo dele.
  if(typeof ResizeObserver !== 'undefined'){
    new ResizeObserver(function(){
      if(liveTopbar.offsetHeight) document.documentElement.style.setProperty('--topbar-h', liveTopbar.offsetHeight + 'px');
    }).observe(liveTopbar);
  }

  // Menu "Mais": folha que sobe de baixo no celular, menu suspenso no desktop.
  function openMoreMenu(){
    moreMenu.hidden = false;
    moreMenuBtn.setAttribute('aria-expanded', 'true');
    const first = Array.from(moreMenu.querySelectorAll('#copyLinkBtn, .menu-item'))
      .find(el => !el.hidden && el.getClientRects && el.getClientRects().length);
    if(first) first.focus();
  }

  function closeMoreMenu(returnFocus){
    if(moreMenu.hidden) return;
    moreMenu.hidden = true;
    moreMenuBtn.setAttribute('aria-expanded', 'false');
    if(returnFocus) moreMenuBtn.focus();
  }

  moreMenuBtn.addEventListener('click', function(){
    if(moreMenu.hidden) openMoreMenu(); else closeMoreMenu(true);
  });

  // Escolher uma ação fecha o menu; "Copiar" fica aberto pra mostrar o "Copiado!".
  moreMenu.addEventListener('click', function(e){
    if(e.target.closest('[data-menu-close]')){ closeMoreMenu(true); return; }
    if(e.target.closest('.menu-item')) closeMoreMenu(false);
  });

  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && !moreMenu.hidden) closeMoreMenu(true);
  });

  document.addEventListener('click', function(e){
    if(moreMenu.hidden || !e.target.closest) return;
    if(e.target.closest('#moreMenu') || e.target.closest('#moreMenuBtn')) return;
    closeMoreMenu(false);
  });

  // Observações à vista no começo da página (antes ficavam só no fim).
  function updateNotesPreview(){
    const text = (notesBox.value || '').trim().replace(/\s+/g, ' ');
    notesPreview.hidden = !text;
    document.getElementById('notesPreviewText').textContent = text;
  }

  function goToNotes(){
    document.getElementById('notesSection').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    if(!notesBox.readOnly) setTimeout(() => notesBox.focus({ preventScroll: true }), prefersReducedMotion() ? 0 : 400);
  }

  notesPreview.addEventListener('click', goToNotes);

  // "Só pendentes": lembrado por evento neste aparelho.
  function pendingOnlyKey(){ return PENDING_ONLY_PREFIX + window.location.pathname; }

  function readPendingOnly(){
    try { return localStorage.getItem(pendingOnlyKey()) === '1'; } catch(err){ return false; }
  }

  function writePendingOnly(){
    try {
      if(pendingOnly) localStorage.setItem(pendingOnlyKey(), '1');
      else localStorage.removeItem(pendingOnlyKey());
    } catch(err){}
  }

  function sceneStatus(id){ return recorded[id] ? recorded[id].status : null; }

  function renderedSceneIds(){
    return CONTENT.filter(c => document.getElementById('card-'+c.id)).map(c => c.id);
  }

  // O filtro vale no instante em que é aplicado: cena marcada depois fica à
  // vista (esmaecida) até a próxima aplicação, pra não sumir debaixo do dedo
  // por causa de um toque errado.
  function applyPendingFilter(){
    appView.classList.toggle('pending-only', pendingOnly);
    pendingFilterBtn.setAttribute('aria-pressed', String(pendingOnly));
    CONTENT.forEach(item => {
      const card = document.getElementById('card-'+item.id);
      if(card) card.classList.toggle('is-filtered', pendingOnly && !isPendingStatus(sceneStatus(item.id)));
    });
    PHASES.forEach(phase => {
      const section = document.getElementById(phase.key);
      if(!section) return;
      const ids = CONTENT.filter(c => c.phase === phase.key).map(c => c.id);
      section.classList.toggle('is-complete', pendingOnly && ids.length > 0 && countPending(ids, sceneStatus) === 0);
    });
    const ids = renderedSceneIds();
    document.getElementById('pendingEmpty').hidden = !(pendingOnly && ids.length && countPending(ids, sceneStatus) === 0);
  }

  function unfilterCard(card, id){
    card.classList.remove('is-filtered');
    const item = CONTENT.find(c => String(c.id) === String(id));
    const section = item && document.getElementById(item.phase);
    if(section) section.classList.remove('is-complete');
    document.getElementById('pendingEmpty').hidden = true;
  }

  pendingFilterBtn.addEventListener('click', function(){
    pendingOnly = !pendingOnly;
    writePendingOnly();
    applyPendingFilter();
  });

  // "Próxima": a próxima cena pendente depois da que está no topo da tela.
  function updateNextSceneButton(){
    const ids = renderedSceneIds();
    nextSceneBtn.hidden = !ids.length || countPending(ids, sceneStatus) === 0;
  }

  function currentSceneId(){
    const top = liveTopbar.getBoundingClientRect ? liveTopbar.getBoundingClientRect().bottom : 0;
    for(const id of renderedSceneIds()){
      const card = document.getElementById('card-'+id);
      if(card.classList.contains('is-filtered') || !card.getBoundingClientRect) continue;
      if(card.getBoundingClientRect().bottom > top + 8) return id;
    }
    return null;
  }

  function goToScene(id){
    const card = document.getElementById('card-'+id);
    if(!card) return;
    card.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    const title = document.getElementById('card-title-'+id);
    if(title) title.focus({ preventScroll: true });
    card.classList.remove('is-highlight');
    void card.offsetWidth;
    card.classList.add('is-highlight');
    setTimeout(() => card.classList.remove('is-highlight'), 1600);
  }

  nextSceneBtn.addEventListener('click', function(){
    // é aqui que as cenas marcadas com o filtro ligado saem de vista
    if(pendingOnly) applyPendingFilter();
    const target = nextPendingId(renderedSceneIds(), sceneStatus, currentSceneId());
    if(target !== null) goToScene(target);
  });

  // Fase atual acende na barra de fases conforme a rolagem.
  function setCurrentPhasePill(key){
    document.querySelectorAll('.phase-pill').forEach(pill => {
      const on = pill.id === 'pill-'+key;
      pill.classList.toggle('is-current', on);
      if(on) pill.setAttribute('aria-current', 'true'); else pill.removeAttribute('aria-current');
    });
    const pill = document.getElementById('pill-'+key);
    const nav = document.getElementById('phaseNav');
    if(pill && nav.scrollTo) nav.scrollTo({ left: Math.max(0, pill.offsetLeft - 16), behavior: scrollBehavior() });
  }

  function observePhases(){
    if(phaseObserver) phaseObserver.disconnect();
    if(typeof IntersectionObserver === 'undefined') return;
    const top = (liveTopbar.offsetHeight || 150) + 8;
    phaseObserver = new IntersectionObserver(function(entries){
      const visible = entries.filter(en => en.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if(visible.length) setCurrentPhasePill(visible[0].target.id);
    }, { rootMargin: '-' + top + 'px 0px -55% 0px' });
    document.querySelectorAll('#phasesContainer .phase').forEach(section => phaseObserver.observe(section));
  }

  function tickClock(){
    const now = new Date();
    document.getElementById('clockText').textContent = now.toLocaleTimeString('pt-BR', {hour12:false});
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ---------- relatório pós-evento ----------

  function generateReport(){
    const eventTitle = document.getElementById('eventTitle').textContent || 'Evento';
    const total = CONTENT.length;
    const doneCount = CONTENT.filter(c => isDone(c.id)).length;
    const pct = total ? Math.round((doneCount/total)*100) : 0;
    const postedCount = CONTENT.filter(c => recorded[c.id] && recorded[c.id].status === 'postado').length;
    const missionTotal = MISSIONS.reduce((sum, cat) => sum + cat.items.length, 0);
    const missionDone = Object.keys(missionsDone).length;
    const generatedAt = new Date().toLocaleString('pt-BR');

    const statusLabel = { andamento: 'Em andamento', feito: 'Feito', postado: 'Postado' };
    const phasesHTML = PHASES.map(phase => {
      const items = CONTENT.filter(c => c.phase === phase.key);
      if(!items.length) return '';
      const rows = items.map(item => {
        const entry = recorded[item.id];
        const status = entry ? statusLabel[entry.status] || '-' : 'Não iniciado';
        const delay = entry ? formatDelay(entry.feitoAt, entry.postadoAt) : null;
        // registro de antes da data ser guardada: mostra o horário, mas não chuta a demora
        const delayLegacy = !delay && entry && entry.feitoAt && entry.postadoAt && (isLegacyStamp(entry.feitoAt) || isLegacyStamp(entry.postadoAt));
        return (
          '<tr>'+
            '<td class="report-status">'+(entry && (entry.status === 'feito' || entry.status === 'postado') ? '✓' : '-')+'</td>'+
            '<td>'+escapeHTML(item.title)+'</td>'+
            '<td class="report-muted">'+escapeHTML(item.formato)+'</td>'+
            '<td class="report-muted">'+escapeHTML(status)+'</td>'+
            '<td class="report-muted">'+(entry && entry.andamentoAt ? escapeHTML(formatStampFull(entry.andamentoAt)) : '-')+'</td>'+
            '<td class="report-muted">'+(entry && entry.feitoAt ? escapeHTML(formatStampFull(entry.feitoAt)) : '-')+'</td>'+
            '<td class="report-muted">'+(entry && entry.postadoAt ? escapeHTML(formatStampFull(entry.postadoAt)) : '-')+'</td>'+
            '<td class="report-muted"'+(delayLegacy ? ' title="Registrado sem data: a demora não pode ser calculada"' : '')+'>'+(delay ? escapeHTML(delay) : '-')+'</td>'+
          '</tr>'
        );
      }).join('');
      return (
        '<h3>'+escapeHTML(phase.label)+'</h3>'+
        '<div class="report-table-wrap"><table class="report-table"><thead><tr><th></th><th>Cena</th><th>Formato</th><th>Status</th><th>Iniciado</th><th>Concluído</th><th>Postado</th><th>Demora p/ postar</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
      );
    }).join('');

    const missionsHTML = MISSIONS.length ? (
      '<h3>Missões (momentos soltos)</h3>'+
      MISSIONS.map(cat => {
        const rows = cat.items.map((item) => {
          const done = !!missionsDone[cat.key + '-' + item.key];
          return '<tr><td class="report-status">'+(done ? '✓' : '-')+'</td><td>'+escapeHTML(item.text)+'</td></tr>';
        }).join('');
        return '<p class="report-cat-label">'+escapeHTML(cat.emoji||'')+' '+escapeHTML(cat.label)+'</p><table class="report-table"><tbody>'+rows+'</tbody></table>';
      }).join('')
    ) : '';

    const missionStatHTML = missionTotal
      ? '<div class="report-stat"><b>'+missionDone+'/'+missionTotal+'</b><span>Missões flagradas</span></div>'
      : '';

    reportContent.innerHTML =
      '<h1>'+escapeHTML(eventTitle)+'</h1>'+
      '<div class="report-sub">Relatório de cobertura · gerado em '+escapeHTML(generatedAt)+'</div>'+
      '<div class="report-stats">'+
        '<div class="report-stat"><b>'+doneCount+'/'+total+'</b><span>Cenas capturadas ('+pct+'%)</span></div>'+
        '<div class="report-stat"><b>'+postedCount+'/'+doneCount+'</b><span>Já postadas</span></div>'+
        missionStatHTML+
      '</div>'+
      phasesHTML+
      missionsHTML+
      '<div class="report-footer">Gerado por CAPTURA</div>';

    showView('report');
  }

  document.getElementById('exportReportBtn').addEventListener('click', generateReport);
  document.getElementById('reportBackBtn').addEventListener('click', function(){ showView('app'); });
  document.getElementById('reportPrintBtn').addEventListener('click', function(){ window.print(); });

  // ---------- aviso temporário ----------

  const appToast = document.getElementById('appToast');
  const appToastText = document.getElementById('appToastText');
  const appToastAction = document.getElementById('appToastAction');
  let toastTimer = null;
  let toastAction = null;

  function hideToast(){
    clearTimeout(toastTimer);
    toastAction = null;
    appToast.hidden = true;
  }

  function showToast(text, { actionLabel = '', onAction = null, ms = 6000 } = {}){
    clearTimeout(toastTimer);
    appToastText.textContent = text;
    toastAction = onAction;
    appToastAction.hidden = !actionLabel;
    appToastAction.textContent = actionLabel;
    appToast.hidden = false;
    toastTimer = setTimeout(hideToast, ms);
  }

  appToastAction.addEventListener('click', function(){
    const action = toastAction;
    hideToast();
    if(action) action();
  });

  // ---------- reiniciar o checklist ----------
  // Apaga o progresso da equipe inteira, então: só dono e editores (o servidor
  // também recusa), confirmação com o que será apagado, só com internet e sem
  // ações pendentes na fila (senão o reinício passaria na frente delas), e 30 s
  // pra desfazer na tela de quem reiniciou.

  const resetBtn = document.getElementById('resetBtn');
  const resetDialog = document.getElementById('resetDialog');
  const resetDialogText = document.getElementById('resetDialogText');
  const resetConfirmBtn = document.getElementById('resetConfirmBtn');
  const resetCancelBtn = document.getElementById('resetCancelBtn');
  const UNDO_RESET_MS = 30000;
  let lastLocalResetAt = 0;

  function openResetDialog(){
    if(typeof resetDialog.showModal === 'function') resetDialog.showModal();
    else resetDialog.setAttribute('open', '');
  }

  function closeResetDialog(){
    if(typeof resetDialog.close === 'function') resetDialog.close();
    else resetDialog.removeAttribute('open');
  }

  // O que existia antes do reinício, com os horários originais, pra "Desfazer".
  function takeProgressSnapshot(){
    const scenes = Object.entries(recorded).map(([sceneId, entry]) => ({ sceneId, entry: Object.assign({}, entry) }));
    const missions = [];
    MISSIONS.forEach(cat => cat.items.forEach(item => {
      if(missionsDone[cat.key + '-' + item.key]) missions.push({ cat: cat.key, itemKey: item.key });
    }));
    return { scenes, missions };
  }

  function undoReset(snapshot){
    let restored = 0;
    snapshot.scenes.forEach(({ sceneId, entry }) => {
      if(recorded[sceneId]) return; // alguém já marcou de novo: o mais novo vale
      applyStatus(sceneId, entry);
      sendProgress('status', { sceneId, ...entry });
      restored++;
    });
    snapshot.missions.forEach(mission => {
      const key = mission.cat + '-' + mission.itemKey;
      if(missionsDone[key]) return;
      applyMissionKey(key, true);
      sendProgress('mission', mission);
      restored++;
    });
    showToast(restored ? 'Checklist restaurado.' : 'Nada a restaurar: o checklist já foi marcado de novo.', { ms: 5000 });
  }

  resetBtn.addEventListener('click', async function(){
    if(!currentAccess.canWriteProgress || !canReset()) return;
    if(!navigator.onLine){
      showToast('Sem conexão: só dá pra reiniciar com internet, pra não apagar o que a equipe marcou nesse meio tempo.', { ms: 8000 });
      return;
    }
    if((await readOfflineQueue()).length){
      showToast('Ainda há ações sincronizando. Espere terminar e tente de novo.', { ms: 6000 });
      return;
    }
    const scenes = Object.keys(recorded).length;
    const missions = Object.keys(missionsDone).length;
    if(!scenes && !missions){
      showToast('Não há nada marcado pra reiniciar.', { ms: 4000 });
      return;
    }
    resetDialogText.textContent = 'Isso apaga o progresso de ' + pluralize(scenes, 'cena com progresso', 'cenas com progresso') +
      ' e ' + pluralize(missions, 'missão marcada', 'missões marcadas') + ', pra toda a equipe. Você terá 30 segundos pra desfazer.';
    resetConfirmBtn.disabled = false;
    openResetDialog();
  });

  resetCancelBtn.addEventListener('click', closeResetDialog);

  resetConfirmBtn.addEventListener('click', async function(){
    resetConfirmBtn.disabled = true;
    const snapshot = takeProgressSnapshot();
    // marcado antes de enviar: o tempo real pode entregar o reinício antes da
    // resposta, e quem reiniciou não deve ver o aviso "por alguém da equipe"
    lastLocalResetAt = Date.now();
    try {
      const resp = await postProgress({ eventId: currentEventId, action: 'reset', payload: {}, route: { kind: 'id', key: currentEventId, auth: true } });
      if(!resp.ok){
        const body = await resp.json().catch(() => ({}));
        const error = new Error('recusado');
        error.serverMessage = body && body.error;
        throw error;
      }
      resetAllProgress();
      closeResetDialog();
      showToast('Checklist reiniciado.', { actionLabel: 'Desfazer', onAction: () => undoReset(snapshot), ms: UNDO_RESET_MS });
    } catch(err){
      lastLocalResetAt = 0;
      closeResetDialog();
      showToast((err && err.serverMessage) || 'Não consegui reiniciar agora. Nada foi apagado.', { ms: 8000 });
    }
  });

  // ---------- utilitários ----------

  function withTimeout(promise, ms){
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms);
      Promise.resolve(promise).then(
        value => { clearTimeout(timer); resolve(value); },
        err => { clearTimeout(timer); reject(err); }
      );
    });
  }

  function pluralize(n, one, many){ return n + ' ' + (n === 1 ? one : many); }

  // ---------- resultado da inclusão de membros ----------

  function hidePublishSummary(){
    clearTimeout(invitePollTimer);
    invitePollTimer = null;
    publishSummary.hidden = true;
    publishSummaryList.innerHTML = '';
    retryInvitesBtn.hidden = true;
    document.getElementById('publishShare').hidden = true;
    document.getElementById('publishSummaryTitle').textContent = 'Equipe deste evento';
  }

  // Logo depois de publicar, o link vem junto com o resumo da equipe; depois
  // disso ele mora no menu "Mais".
  function showPublishShare(){
    document.getElementById('publishShareInput').value = document.getElementById('eventLinkInput').value;
    document.getElementById('publishShare').hidden = false;
    document.getElementById('publishSummaryTitle').textContent = 'Evento publicado';
    publishSummary.hidden = false;
  }

  document.getElementById('publishShareCopy').addEventListener('click', function(){
    copyInputValue(document.getElementById('publishShareInput'), this);
  });

  function summaryItems(summary){
    const items = [];
    if(!summary) return items;
    if(summary.added && summary.added.length) items.push({ cls: 'is-ok', text: pluralize(summary.added.length, 'pessoa adicionada', 'pessoas adicionadas') + ' à equipe' });
    if(summary.invited && summary.invited.length) items.push({ cls: 'is-ok', text: pluralize(summary.invited.length, 'convite enviado', 'convites enviados') + ' por email' });
    if(summary.existing && summary.existing.length) items.push({ cls: '', text: pluralize(summary.existing.length, 'pessoa já estava', 'pessoas já estavam') + ' na equipe' });
    if(summary.pending && summary.pending.length) items.push({ cls: 'is-warn', text: pluralize(summary.pending.length, 'convite em processamento', 'convites em processamento') + '…' });
    (summary.invalid || []).forEach(email => items.push({ cls: 'is-error', text: email + ' não pôde ser convidado: email inválido' }));
    (summary.failed || []).forEach(f => items.push({ cls: 'is-error', text: f.email + ' não pôde ser convidado: ' + f.error }));
    (summary.skipped || []).forEach(f => items.push({ cls: 'is-error', text: f.email + ': ' + f.error }));
    return items;
  }

  function renderPublishSummary(summary, opts){
    const canRetry = !(opts && opts.canRetry === false);
    const items = summaryItems(summary);
    if(!items.length){ hidePublishSummary(); return; }
    publishSummaryList.innerHTML = items.map(i => '<li class="'+i.cls+'">'+escapeHTML(i.text)+'</li>').join('');
    retryInvitesBtn.hidden = !(canRetry && summary.failed && summary.failed.length);
    publishSummary.hidden = false;
    // Convites que não couberam no tempo do salvamento continuam no servidor;
    // acompanha até terminarem.
    clearTimeout(invitePollTimer);
    if(canRetry && summary.pending && summary.pending.length && currentEventId){
      const eventId = currentEventId;
      invitePollTimer = setTimeout(() => pollInvites(eventId, 1), 4000);
    }
  }

  async function fetchInvites(eventId){
    const token = await accessToken();
    if(!token) throw new Error('Sessão expirada. Faça login de novo.');
    const resp = await fetch('/api/events/' + encodeURIComponent(eventId) + '/invites', { headers: { Authorization: 'Bearer ' + token } });
    const result = await resp.json().catch(() => ({}));
    if(!resp.ok) throw new Error(result.error || 'Erro ao carregar os convites.');
    return result;
  }

  // Mostra só o que ainda interessa do salvamento: pendentes que terminaram.
  async function pollInvites(eventId, attempt){
    if(currentEventId !== eventId || publishSummary.hidden) return;
    try {
      const { invites } = await fetchInvites(eventId);
      const pending = invites.filter(i => i.status === 'pending' || i.status === 'processing');
      const failed = invites.filter(i => i.status === 'failed').map(i => ({ email: i.email, error: i.last_error || 'Não foi possível convidar.' }));
      const added = invites.filter(i => i.status === 'added').map(i => i.email);
      const invited = invites.filter(i => i.status === 'invited').map(i => i.email);
      renderPublishSummary({ added, invited, existing: [], pending: pending.map(i => i.email), invalid: [], failed, skipped: [] }, { canRetry: true });
      if(pending.length && attempt < 15){
        clearTimeout(invitePollTimer);
        invitePollTimer = setTimeout(() => pollInvites(eventId, attempt + 1), 4000);
      }
    } catch(err){ /* mantém o último resumo */ }
  }

  async function retryFailedInvites(eventId){
    const token = await accessToken();
    if(!token) throw new Error('Sessão expirada. Faça login de novo.');
    const resp = await fetch('/api/events/' + encodeURIComponent(eventId) + '/invites/retry', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    const result = await resp.json().catch(() => ({}));
    if(!resp.ok) throw new Error(result.error || 'Erro ao reenviar os convites.');
    return result;
  }

  document.getElementById('publishSummaryClose').addEventListener('click', hidePublishSummary);

  retryInvitesBtn.addEventListener('click', async function(){
    if(!currentEventId) return;
    retryInvitesBtn.disabled = true;
    try {
      const { summary } = await retryFailedInvites(currentEventId);
      // no resumo pós-reenvio, "já adicionados" de antes não interessam
      renderPublishSummary(Object.assign({}, summary, { existing: [] }), { canRetry: true });
    } catch(err){
      alert('Não consegui reenviar (' + (err.message || 'erro desconhecido') + ').');
    } finally {
      retryInvitesBtn.disabled = false;
    }
  });

  // ---------- convites na tela "Gerenciar equipe" ----------

  const INVITE_LABELS = {
    pending: ['Enviando…', 'pending'], processing: ['Enviando…', 'pending'],
    added: ['Adicionado', 'ok'], existing: ['Já na equipe', 'ok'],
    invited: ['Convite enviado', 'ok'], failed: ['Falhou', 'failed']
  };

  function inviteRowHTML(invite){
    const label = INVITE_LABELS[invite.status] || [invite.status, 'pending'];
    const detail = invite.status === 'failed' ? (invite.last_error || 'Não foi possível convidar.') : (invite.status === 'pending' && invite.last_error ? invite.last_error : '');
    return (
      '<div class="history-card">'+
        '<div>'+
          '<div class="history-title">'+escapeHTML(invite.email)+'</div>'+
          (detail ? '<div class="history-meta">'+escapeHTML(detail)+'</div>' : '')+
        '</div>'+
        '<span class="invite-status invite-status--'+label[1]+'">'+escapeHTML(label[0])+'</span>'+
      '</div>'
    );
  }

  async function renderMembersInvites(){
    if(!currentEventId) return;
    invitesStatus.textContent = '';
    try {
      const { invites } = await fetchInvites(currentEventId);
      invitesList.innerHTML = invites.length
        ? invites.map(inviteRowHTML).join('')
        : '<div class="history-empty">Nenhum convite por email ainda.</div>';
      membersRetryInvitesBtn.hidden = !invites.some(i => i.status === 'failed');
    } catch(err){
      invitesList.innerHTML = '<div class="history-empty">Não consegui carregar os convites (' + escapeHTML(err.message || 'erro') + ').</div>';
      membersRetryInvitesBtn.hidden = true;
    }
  }

  membersRetryInvitesBtn.addEventListener('click', async function(){
    membersRetryInvitesBtn.disabled = true;
    invitesStatus.textContent = 'Reenviando…';
    try {
      await retryFailedInvites(currentEventId);
      invitesStatus.textContent = 'Convites reenviados.';
      showMembersView();
    } catch(err){
      invitesStatus.textContent = 'Não consegui reenviar (' + (err.message || 'erro desconhecido') + ').';
    } finally {
      membersRetryInvitesBtn.disabled = false;
    }
  });

  // ---------- compartilhamento (tela de criar/editar) ----------

  const SHARE_HINTS = {
    team: 'Só você e os membros da equipe, com conta, abrem o evento. Quem tiver só o link não vê nada.',
    view: 'Quem tiver o link vê a checklist em tempo real, mas não marca progresso. A equipe marca normalmente.',
    collab: 'Quem tiver o link vê e marca progresso, sem precisar de conta. Bom pra equipe de campo que não faz login.'
  };

  function canManageShare(){
    // evento novo: quem publica vira o dono; evento existente: só o dono
    return !editingEventId || currentAccess.role === 'owner';
  }

  function renderShareSettings(){
    if(!draft || !canManageShare()){
      shareSettings.hidden = true;
      return;
    }
    shareSettings.hidden = false;
    const mode = draft.share_mode || (editingEventId ? null : 'collab');
    document.querySelectorAll('input[name="shareMode"]').forEach(radio => { radio.checked = radio.value === mode; });
    const hint = [SHARE_HINTS[mode] || ''];
    const legacy = document.getElementById('shareLegacyHint');
    legacy.hidden = true;
    const linkBox = document.getElementById('shareLinkBox');
    const noLinkBox = document.getElementById('shareNoLinkBox');
    if(!editingEventId){
      linkBox.hidden = true;
      noLinkBox.hidden = true;
      if(mode !== 'team') hint.push('O link é criado ao publicar.');
    } else if(editingShare){
      const hasLink = !!editingShare.share_path;
      linkBox.hidden = !hasLink;
      noLinkBox.hidden = hasLink;
      if(hasLink) document.getElementById('shareLinkInput').value = window.location.origin + editingShare.share_path;
      if(editingShare.legacy_active){
        legacy.hidden = false;
        legacy.textContent = 'O endereço antigo (' + window.location.origin + '/e/' + editingEventId + ') ainda abre sem conta até ' + formatDateBR(editingShare.legacy_link_until) + '. Mudar o modo, gerar um link novo ou desativar o link encerra o endereço antigo na hora. Envie o link novo pra equipe.';
      }
      if(mode !== editingShare.share_mode) hint.push('A mudança vale ao salvar. Quem estiver com o evento aberto pelo link é reconectado.');
    } else {
      linkBox.hidden = true;
      noLinkBox.hidden = true;
    }
    document.getElementById('shareModeHint').textContent = hint.filter(Boolean).join(' ');
  }

  async function loadEditingShare(eventId){
    try {
      const token = await accessToken();
      if(!token) return;
      const resp = await fetch('/api/events/' + encodeURIComponent(eventId) + '/share', { headers: { Authorization: 'Bearer ' + token } });
      if(!resp.ok) return;
      const share = await resp.json();
      if(editingEventId !== eventId) return;
      editingShare = share;
      if(!draft.share_mode) draft.share_mode = share.share_mode;
      renderShareSettings();
    } catch(err){}
  }

  document.querySelectorAll('input[name="shareMode"]').forEach(radio => {
    radio.addEventListener('change', function(e){
      if(draft && e.target.checked) draft.share_mode = e.target.value;
      renderShareSettings();
    });
  });

  document.getElementById('shareCopyBtn').addEventListener('click', function(){
    copyInputValue(document.getElementById('shareLinkInput'), this);
  });

  // Gerar/desativar link valem na hora (não esperam "Salvar"), como um botão
  // de revogar deve funcionar.
  async function shareRequest(method, suffix, confirmText){
    if(!editingEventId) return;
    if(confirmText && !confirm(confirmText)) return;
    const status = document.getElementById('shareStatus');
    status.textContent = 'Atualizando…';
    try {
      const token = await accessToken();
      if(!token) throw new Error('Sessão expirada. Faça login de novo.');
      const resp = await fetch('/api/events/' + encodeURIComponent(editingEventId) + '/share' + suffix, { method, headers: { Authorization: 'Bearer ' + token } });
      const result = await resp.json().catch(() => ({}));
      if(!resp.ok) throw new Error(result.error || 'Erro ao atualizar o compartilhamento.');
      editingShare = result;
      status.textContent = method === 'DELETE' ? 'Link desativado. O link anterior parou de funcionar.' : 'Link novo criado. O link anterior parou de funcionar.';
      renderShareSettings();
    } catch(err){
      status.textContent = 'Não consegui atualizar (' + (err.message || 'erro desconhecido') + ').';
    }
  }

  document.getElementById('shareRegenerateBtn').addEventListener('click', function(){
    shareRequest('POST', '/regenerate', 'Gerar um link novo? O link atual (e o endereço antigo, se ainda valer) param de funcionar na hora, e quem estiver com ele aberto perde o acesso.');
  });
  document.getElementById('shareDisableBtn').addEventListener('click', function(){
    shareRequest('DELETE', '', 'Desativar o link? Ele para de funcionar na hora e só a equipe, com conta, abre o evento.');
  });
  document.getElementById('shareCreateBtn').addEventListener('click', function(){
    shareRequest('POST', '/regenerate', null);
  });

  // ---------- conflito de edição ----------

  function showConflict(eventId, current){
    const serverDraft = normalizeDraft(current || {});
    conflictState = { eventId, serverDraft, serverRevision: Number.isInteger(current && current.revision) ? current.revision : null };
    try { localStorage.setItem(CONFLICT_DRAFT_PREFIX + eventId, JSON.stringify(draft)); } catch(err){}
    conflictDiff.hidden = true;
    conflictDiff.innerHTML = '';
    conflictStatus.textContent = '';
    conflictPanel.hidden = false;
    window.scrollTo(0, 0);
    if(conflictPanel.focus) conflictPanel.focus();
  }

  function clearConflict(eventId){
    conflictState = null;
    conflictPanel.hidden = true;
    conflictDiff.hidden = true;
    if(eventId){ try { localStorage.removeItem(CONFLICT_DRAFT_PREFIX + eventId); } catch(err){} }
  }

  // Um rascunho que ficou em conflito sobrevive a recarregar a página.
  function restoreConflictDraft(eventId){
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(CONFLICT_DRAFT_PREFIX + eventId) || 'null'); } catch(err){}
    if(!saved || typeof saved !== 'object'){ clearConflict(null); return; }
    const serverDraft = draft;
    draft = normalizeDraft(saved);
    draft.share_mode = serverDraft.share_mode;
    conflictState = { eventId, serverDraft, serverRevision: editingRevision };
    conflictPanel.hidden = false;
    conflictStatus.textContent = 'Recuperamos o rascunho que não pôde ser salvo. Compare com a versão atual antes de decidir.';
  }

  document.getElementById('conflictCompareBtn').addEventListener('click', function(){
    if(!conflictState) return;
    const changes = diffEventDrafts(draft, conflictState.serverDraft);
    conflictDiff.innerHTML = changes.length
      ? '<table><thead><tr><th scope="col">Campo</th><th scope="col">Sua versão</th><th scope="col">Versão atual</th></tr></thead><tbody>'+
        changes.map(c => '<tr><th scope="row">'+escapeHTML(c.label)+'</th><td>'+escapeHTML(c.local)+'</td><td>'+escapeHTML(c.remote)+'</td></tr>').join('')+
        '</tbody></table>'
      : '<p>Os campos do roteiro são iguais nas duas versões. A outra pessoa pode ter mudado só a versão salva. Recarregue e salve de novo.</p>';
    conflictDiff.hidden = false;
  });

  document.getElementById('conflictCopyBtn').addEventListener('click', function(){
    const text = draftToText(draft);
    const done = () => { conflictStatus.textContent = 'Rascunho copiado. Cole num lugar seguro antes de recarregar.'; };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done).catch(() => { conflictStatus.textContent = 'Não consegui copiar automaticamente.'; });
    } else {
      conflictStatus.textContent = 'Seu navegador não permite copiar automaticamente.';
    }
  });

  document.getElementById('conflictReloadBtn').addEventListener('click', function(){
    if(!conflictState) return;
    if(!confirm('Carregar a versão mais recente? As alterações desta tela que não foram salvas serão descartadas (copie o rascunho antes, se precisar).')) return;
    const shareMode = draft.share_mode;
    draft = conflictState.serverDraft;
    draft.share_mode = shareMode;
    editingRevision = conflictState.serverRevision;
    editingLoadedNotes = draft.notes || '';
    clearConflict(conflictState.eventId);
    renderPreviewAll();
  });

  // ---------- autenticação ----------

  function updateAuthUI(){
    authStripLoggedOut.hidden = !!currentUser;
    authStripLoggedIn.hidden = !currentUser;
    if(currentUser) authStripEmail.textContent = currentUser.email || '';
    updateImportContext();
    updateEditLinkVisibility();
    refreshSaveButton();
    refreshManageMembersButton();
    refreshNotesEditability();
    refreshGoogleCalendarButton();
  }

  async function accessToken(){
    // aberto offline sem cliente de login (tela de recuperação): segue sem conta
    if(!sb) return cachedAccessToken;
    const { data } = await sb.auth.getSession();
    cachedAccessToken = data.session ? data.session.access_token : null;
    return cachedAccessToken;
  }

  // Depois de entrar pela tela de "evento restrito", volta pro evento.
  function restoreReturnToIfAny(){
    const target = localStorage.getItem(RETURN_TO_KEY);
    if(!currentUser || !target) return false;
    localStorage.removeItem(RETURN_TO_KEY);
    if(!/^\/(e|s)\/[A-Za-z0-9_-]+(\/editar)?$/.test(target) && target !== '/conta') return false;
    history.replaceState({}, '', target);
    route();
    return true;
  }

  // Versão, notas e compartilhamento da edição sobrevivem ao desvio pelo login;
  // sem a versão o servidor recusaria o save (base_revision é obrigatório).
  function editingSnapshot(){
    if(!editingEventId) return null;
    return { revision: editingRevision, notes: editingLoadedNotes, share: editingShare };
  }

  function restoreEditingSnapshot(snap){
    editingRevision = snap && Number.isInteger(snap.revision) ? snap.revision : null;
    editingLoadedNotes = snap && typeof snap.notes === 'string' ? snap.notes : null;
    editingShare = snap && snap.share ? snap.share : null;
  }

  function restorePendingRoteiroIfAny(){
    if(window.location.pathname !== '/') return false;
    const pending = localStorage.getItem(PENDING_ROTEIRO_KEY);
    if(!currentUser || !pending) return false;
    localStorage.removeItem(PENDING_ROTEIRO_KEY);
    let saved;
    try { saved = JSON.parse(pending); } catch { saved = null; }
    const wrapped = saved && typeof saved.text === 'string';
    roteiroSource = wrapped ? saved.draft || null : null;
    draft = roteiroSource;
    editingEventId = wrapped ? saved.editingEventId || null : null;
    restoreEditingSnapshot(wrapped ? saved.editing : null);
    const text = wrapped ? saved.text : pending;
    if(draft) {
      updatePreviewContext();
      renderPreviewAll();
    }
    showView('import');
    roteiroInput.value = text;
    runGenerate(text);
    return true;
  }

  function restorePendingDraftIfAny(){
    if(window.location.pathname !== '/') return false;
    const pending = localStorage.getItem(PENDING_DRAFT_KEY);
    if(!currentUser || !pending) return false;
    localStorage.removeItem(PENDING_DRAFT_KEY);
    let parsed;
    try {
      parsed = JSON.parse(pending);
    } catch(err){
      return false;
    }
    // formato { draft, editingEventId }; aceita o formato antigo (só o draft) também
    const hasWrapper = parsed && typeof parsed === 'object' && 'draft' in parsed;
    draft = hasWrapper ? parsed.draft : parsed;
    editingEventId = hasWrapper ? (parsed.editingEventId || null) : null;
    restoreEditingSnapshot(hasWrapper ? parsed.editing : null);
    generatedInPreview = !!parsed.generatedInPreview;
    updatePreviewContext();
    renderPreviewAll();
    showView('preview');
    return true;
  }

  const LOGIN_REASONS = {
    generate: { title: 'Entre para gerar o checklist', note: 'Seu texto fica salvo e a geração continua assim que você entrar.' },
    publish: { title: 'Entre para publicar', note: 'Seu roteiro fica salvo e volta pra revisão assim que você entrar.' },
    history: { title: 'Entre para ver seus eventos', note: '' },
    account: { title: 'Entre para ver sua conta', note: '' },
    team: { title: 'Entre com a conta da equipe', note: 'Depois do login você volta pra este evento.' }
  };

  function showLogin(reason){
    const r = LOGIN_REASONS[reason] || { title: 'Entrar no CAPTURA', note: '' };
    document.getElementById('loginTitle').textContent = r.title;
    const reasonEl = document.getElementById('loginReason');
    reasonEl.textContent = r.note;
    reasonEl.hidden = !r.note;
    setLoginStatus('');
    showView('login');
  }

  // Recado do login: vermelho só pra erro; "link enviado" é confirmação.
  function setLoginStatus(text, kind){
    loginStatus.textContent = text;
    loginStatus.hidden = !text;
    loginStatus.classList.toggle('import-error--ok', kind === 'ok');
  }

  authStripLoginBtn.addEventListener('click', function(){ showLogin(); });

  loginBackBtn.addEventListener('click', function(){ showView('import'); });

  function loginUnavailable(){
    if(sb) return false;
    setLoginStatus('Sem conexão: entrar na conta precisa de internet. Conecte-se e recarregue a página.');
    return true;
  }

  googleLoginBtn.addEventListener('click', async function(){
    if(loginUnavailable()) return;
    setLoginStatus('');
    googleLoginBtn.disabled = true;
    try {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/' } });
      if(error){
        setLoginStatus(error.message || 'Erro ao entrar com o Google.');
        googleLoginBtn.disabled = false;
      }
      // sem erro: o navegador já está sendo redirecionado pro Google, não precisa reabilitar o botão
    } catch(err){
      setLoginStatus(err.message || 'Erro ao entrar com o Google.');
      googleLoginBtn.disabled = false;
    }
  });

  loginSubmitBtn.addEventListener('click', async function(){
    if(loginUnavailable()) return;
    const email = loginEmailInput.value.trim();
    setLoginStatus('');
    if(!email){
      setLoginStatus('Digite um email válido.');
      return;
    }
    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = 'Enviando…';
    try {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + '/' } });
      if(error) setLoginStatus(error.message || 'Erro ao enviar o link.');
      else setLoginStatus('Link enviado! Confira seu email (' + email + ').', 'ok');
    } finally {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = 'Enviar link de acesso';
    }
  });

  authStripLogoutBtn.addEventListener('click', async function(){
    if(sb) await withTimeout(sb.auth.signOut(), 5000).catch(() => {});
    await clearOfflineEventData();
    history.pushState({}, '', '/');
    showView('import');
  });

  // Ao sair da conta, as cópias offline dos eventos (que podem ter emails da
  // equipe) saem do aparelho. A configuração do app fica.
  async function clearOfflineEventData(){
    try { localStorage.removeItem(OFFLINE_EVENTS_KEY); } catch(err){}
    if(typeof caches === 'undefined') return;
    try {
      const cache = await caches.open('captura-data-v1');
      for(const request of await cache.keys()){
        if(new URL(request.url).pathname !== '/api/config') await cache.delete(request);
      }
    } catch(err){}
  }

  historyNewBtn.addEventListener('click', function(){
    backToImport();
  });

  // ---------- roteamento ----------

  function route(){
    if(restorePendingRoteiroIfAny()) return;
    if(restorePendingDraftIfAny()) return;
    const path = window.location.pathname;
    let m;
    if((m = path.match(/^\/e\/([a-zA-Z0-9-]+)\/editar$/))){ loadEventForEdit(m[1]); return; }
    if(path === '/historico'){ showHistoryView(); return; }
    if(path === '/conta'){ showAccountView(); return; }
    if((m = path.match(/^\/e\/([a-zA-Z0-9-]+)$/))){ loadEventFromUrl(m[1]); return; }
    if((m = path.match(/^\/s\/([A-Za-z0-9_-]+)$/))){ loadEventFromShare(m[1]); return; }
    roteiroSource = null;
    draft = null;
    editingEventId = null;
    showView('import');
  }

  window.addEventListener('popstate', route);

  // ---------- inicialização ----------
  // Antes: se /api/config falhasse (offline, servidor fora), a promessa
  // rejeitava sem tratamento e a tela ficava em "Carregando…" pra sempre.

  function initError(kind, status){
    const err = new Error(kind);
    err.kind = kind;
    err.status = status;
    return err;
  }

  function isValidConfig(cfg){
    return !!cfg && typeof cfg.supabaseUrl === 'string' && /^https?:\/\//.test(cfg.supabaseUrl)
      && typeof cfg.supabaseAnonKey === 'string' && cfg.supabaseAnonKey.length > 0;
  }

  async function loadConfig(){
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let resp;
    try {
      resp = await fetch('/api/config', { signal: controller.signal });
    } catch(err){
      throw initError(navigator.onLine === false ? 'offline' : 'network');
    } finally {
      clearTimeout(timer);
    }
    const offlineHeader = resp.headers && resp.headers.get && resp.headers.get('X-Captura-Offline');
    if(offlineHeader) throw initError('offline');
    if(!resp.ok) throw initError('server', resp.status);
    let cfg;
    try { cfg = await resp.json(); } catch(err){ throw initError('config'); }
    // Configuração incompleta é problema do servidor, não da conexão.
    if(!isValidConfig(cfg)) throw initError('config');
    return cfg;
  }

  const INIT_MESSAGES = {
    offline: 'Sem conexão com a internet. Na primeira vez, o CAPTURA precisa de internet pra carregar. Conecte-se e toque em "Tentar novamente".',
    offlineWithEvents: 'Sem conexão com a internet. Você pode abrir os eventos que já abriu neste aparelho, ou tentar de novo quando a conexão voltar.',
    network: 'Não foi possível falar com o servidor. Verifique a conexão e toque em "Tentar novamente".',
    server: 'O servidor do CAPTURA não respondeu corretamente. Tente novamente em alguns instantes.',
    config: 'O servidor respondeu com uma configuração incompleta. Isso não é problema da sua conexão. Avise quem administra o CAPTURA.',
    library: 'Não foi possível carregar os arquivos do app. Verifique a conexão e toque em "Tentar novamente".',
    timeout: 'O CAPTURA demorou demais pra abrir. Verifique a conexão e toque em "Tentar novamente".'
  };

  async function showInitError(err){
    const kind = (err && err.kind) || 'network';
    const offlineLike = kind === 'offline' || kind === 'network' || kind === 'timeout' || kind === 'library';
    const events = offlineLike ? await availableOfflineEvents() : [];
    let message = INIT_MESSAGES[kind] || INIT_MESSAGES.network;
    if(kind === 'offline' && events.length) message = INIT_MESSAGES.offlineWithEvents;
    if(kind === 'server' && err.status) message += ' (erro ' + err.status + ')';
    document.getElementById('initErrorTitle').textContent = kind === 'config' ? 'O CAPTURA está com um problema de configuração' : 'Não foi possível abrir o CAPTURA';
    document.getElementById('initErrorMessage').textContent = message;
    const offlineBtn = document.getElementById('initOfflineBtn');
    const list = document.getElementById('initOfflineList');
    offlineBtn.hidden = !events.length;
    list.hidden = true;
    list.innerHTML = events.map(e =>
      '<li><button class="btn" type="button" data-offline-path="'+escapeAttr(e.path)+'">'+escapeHTML(e.title || 'Evento')+'</button></li>'
    ).join('');
    showView('initError');
  }

  document.getElementById('initRetryBtn').addEventListener('click', function(){ initAuth(); });

  document.getElementById('initOfflineBtn').addEventListener('click', function(){
    document.getElementById('initOfflineList').hidden = false;
  });

  // Abre um evento salvo sem o cliente de login: o service worker entrega a
  // última cópia e o progresso marcado entra na fila local.
  document.getElementById('initOfflineList').addEventListener('click', function(e){
    const button = e.target.closest('[data-offline-path]');
    if(!button) return;
    history.pushState({}, '', button.dataset.offlinePath);
    route();
  });

  let authListenerAttached = false;
  let initInProgress = false;

  async function initAuth(){
    if(initInProgress) return;
    initInProgress = true;
    showView('loading');
    // rede de segurança: nada deve deixar a tela presa em "Carregando…"
    const watchdog = setTimeout(() => {
      if(!loadingView.hidden) showInitError(initError('timeout'));
    }, 20000);
    try {
      if(!sb){
        const cfg = await loadConfig();
        if(typeof supabase === 'undefined' || !supabase || !supabase.createClient) throw initError('library');
        sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      }
    } catch(err){
      clearTimeout(watchdog);
      initInProgress = false;
      await showInitError(err);
      return;
    }
    // A sessão fica salva no navegador; offline, renovar o token pode travar.
    let session = null;
    try {
      const result = await withTimeout(sb.auth.getSession(), 5000);
      session = result && result.data ? result.data.session : null;
    } catch(err){ session = null; }
    currentUser = session?.user || null;
    cachedAccessToken = session?.access_token || null;
    updateAuthUI();
    if(!authListenerAttached){
      authListenerAttached = true;
      sb.auth.onAuthStateChange(function(_evt, session){
        currentUser = session?.user || null;
        cachedAccessToken = session?.access_token || null;
        updateAuthUI();
        if(restoreReturnToIfAny()) return;
        if(!restorePendingRoteiroIfAny()) restorePendingDraftIfAny();
      });
    }
    clearTimeout(watchdog);
    initInProgress = false;
    if(restoreReturnToIfAny()) return;
    route();
  }

  initAuth();
  updateSyncStatus();
  flushProgressQueue();
})();
