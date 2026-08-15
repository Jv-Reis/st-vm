(function(){
  const ICONS = ['pin', 'gear', 'mic', 'play', 'users', 'cup', 'chat', 'flag', 'film', 'box', 'signal', 'heart'];

  const EXAMPLE_ROTEIRO = `Evento: Ana & Bruno — Espaço Villa Verde, casamento com cerimônia e festa.

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
  const roteiroInput = document.getElementById('roteiroInput');
  const generateBtn = document.getElementById('generateBtn');
  const exampleBtn = document.getElementById('exampleBtn');
  const quickCreateBtn = document.getElementById('quickCreateBtn');
  const importError = document.getElementById('importError');
  const previewPhasesContainer = document.getElementById('previewPhasesContainer');
  const previewMissionsContainer = document.getElementById('previewMissionsContainer');
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
  const editEventLink = document.getElementById('editEventLink');
  const reportView = document.getElementById('reportView');
  const reportContent = document.getElementById('reportContent');
  const previewEventDate = document.getElementById('previewEventDate');
  const previewEventEndDate = document.getElementById('previewEventEndDate');
  const eventDateWarning = document.getElementById('eventDateWarning');
  const previewEventLocation = document.getElementById('previewEventLocation');
  const calendarLinkBtn = document.getElementById('calendarLinkBtn');

  const VIEWS = { loading: loadingView, import: importView, preview: previewView, login: loginView, history: historyView, app: appView, report: reportView };
  function showView(name){
    Object.keys(VIEWS).forEach(key => { VIEWS[key].hidden = key !== name; });
    authStrip.hidden = (name === 'app' || name === 'report' || name === 'loading');
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
  let currentOwnerId = null;
  let editingEventId = null;
  let progressStream = null;
  let streamHadError = false;

  let sb = null;
  let currentUser = null;
  const PENDING_DRAFT_KEY = 'captura_pending_draft';

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

  function iconOptions(selected){
    return ICONS.map(i => '<option value="'+i+'"'+(i===selected?' selected':'')+'>'+i+'</option>').join('');
  }

  // ---------- import ----------

  exampleBtn.addEventListener('click', function(){
    roteiroInput.value = EXAMPLE_ROTEIRO;
    roteiroInput.focus();
  });

  quickCreateBtn.addEventListener('click', function(){
    loadPreview({ event_title: '', phases: [], scenes: [], missions: [] });
  });

  generateBtn.addEventListener('click', async function(){
    const text = roteiroInput.value.trim();
    importError.hidden = true;
    if(text.length < 20){
      importError.textContent = 'Cole um roteiro com mais conteúdo antes de gerar.';
      importError.hidden = false;
      return;
    }
    generateBtn.disabled = true;
    exampleBtn.disabled = true;
    generateBtn.textContent = 'Gerando…';
    try {
      const resp = await fetch('/api/parse-roteiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await resp.json();
      if(!resp.ok){
        throw new Error(data.error || 'Erro ao gerar o checklist.');
      }
      loadPreview(data);
    } catch(err){
      importError.textContent = err.message || 'Erro inesperado ao gerar o checklist.';
      importError.hidden = false;
    } finally {
      generateBtn.disabled = false;
      exampleBtn.disabled = false;
      generateBtn.textContent = 'Gerar checklist';
    }
  });

  // ---------- preview / edit ----------

  function normalizeDraft(data){
    return {
      event_title: data.event_title || 'Evento sem nome',
      event_date: data.event_date || '',
      event_end_date: data.event_end_date || '',
      event_location: data.event_location || '',
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
        items: m.items || []
      }))
    };
  }

  function loadPreview(data){
    draft = normalizeDraft(data);
    publishBtn.textContent = editingEventId ? 'Salvar alterações' : 'Publicar checklist';
    renderPreviewAll();
    showView('preview');
  }

  function renderPreviewAll(){
    document.getElementById('previewEventTitle').value = draft.event_title;
    previewEventDate.value = draft.event_date || '';
    previewEventEndDate.value = draft.event_end_date || '';
    previewEventLocation.value = draft.event_location || '';
    validateEventDates();

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
        return (
          '<div class="preview-scene-card">'+
            '<div class="preview-scene-top">'+
              '<span class="field-label" style="margin:0;">Cena '+(localIdx+1)+'</span>'+
              '<div class="preview-scene-actions">'+
                '<button type="button" class="icon-btn" data-action="move-scene-up" data-idx="'+i+'" '+(localIdx===0?'disabled':'')+'>↑</button>'+
                '<button type="button" class="icon-btn" data-action="move-scene-down" data-idx="'+i+'" '+(localIdx===scenesInPhase.length-1?'disabled':'')+'>↓</button>'+
                '<button type="button" class="icon-btn danger" data-action="remove-scene" data-idx="'+i+'">✕</button>'+
              '</div>'+
            '</div>'+
            '<div class="field-grid field-row">'+
              '<div><span class="field-label">Título</span><input class="field-input" data-scope="scene" data-idx="'+i+'" data-field="title" value="'+escapeAttr(s.title)+'"></div>'+
              '<div><span class="field-label">Fase</span><select class="field-select" data-scope="scene" data-idx="'+i+'" data-field="phase">'+scenePhaseOptions+'</select></div>'+
            '</div>'+
            '<div class="field-grid field-row">'+
              '<div><span class="field-label">Ícone</span><select class="field-select" data-scope="scene" data-idx="'+i+'" data-field="icon">'+iconOptions(s.icon)+'</select></div>'+
              '<div><span class="field-label">Formato</span><input class="field-input" data-scope="scene" data-idx="'+i+'" data-field="formato" value="'+escapeAttr(s.formato)+'"></div>'+
            '</div>'+
            '<div class="field-row"><span class="field-label">Captura (uma por linha)</span><textarea class="field-textarea" data-scope="scene" data-idx="'+i+'" data-field="capture" data-list="true">'+escapeHTML((s.capture||[]).join('\n'))+'</textarea></div>'+
            '<div class="field-row"><span class="field-label">Fala / texto sugerido</span><textarea class="field-textarea" style="min-height:44px;" data-scope="scene" data-idx="'+i+'" data-field="speech">'+escapeHTML(s.speech||'')+'</textarea></div>'+
            '<div class="field-grid field-row">'+
              '<div><span class="field-label">Pode (uma por linha)</span><textarea class="field-textarea" data-scope="scene" data-idx="'+i+'" data-field="can" data-list="true">'+escapeHTML((s.can||[]).join('\n'))+'</textarea></div>'+
              '<div><span class="field-label">Não pode (uma por linha)</span><textarea class="field-textarea" data-scope="scene" data-idx="'+i+'" data-field="cannot" data-list="true">'+escapeHTML((s.cannot||[]).join('\n'))+'</textarea></div>'+
            '</div>'+
          '</div>'
        );
      }).join('');

      return (
        '<div class="preview-phase-block">'+
          '<div class="preview-phase-head">'+
            '<div class="field-row"><span class="field-label">Fase</span><input class="field-input" data-scope="phase" data-idx="'+pIdx+'" data-field="label" value="'+escapeAttr(phase.label)+'"></div>'+
            '<div class="field-row icon-col"><span class="field-label">Ícone</span><select class="field-select" data-scope="phase" data-idx="'+pIdx+'" data-field="icon">'+iconOptions(phase.icon)+'</select></div>'+
            '<div class="preview-phase-actions">'+
              '<button type="button" class="icon-btn" data-action="move-phase-up" data-idx="'+pIdx+'" '+(pIdx===0?'disabled':'')+'>↑</button>'+
              '<button type="button" class="icon-btn" data-action="move-phase-down" data-idx="'+pIdx+'" '+(pIdx===draft.phases.length-1?'disabled':'')+'>↓</button>'+
              '<button type="button" class="icon-btn danger" data-action="remove-phase" data-idx="'+pIdx+'">✕</button>'+
            '</div>'+
          '</div>'+
          sceneCards+
          '<button type="button" class="add-btn" data-action="add-scene" data-phase-idx="'+pIdx+'">+ Adicionar cena nesta fase</button>'+
        '</div>'
      );
    }).join('');

    renderPreviewMissions();
  }

  function renderPreviewMissions(){
    previewMissionsContainer.innerHTML = draft.missions.map((cat, cIdx) => (
      '<div class="preview-mission-block">'+
        '<div class="preview-scene-top">'+
          '<span class="field-label" style="margin:0;">Categoria</span>'+
          '<button type="button" class="icon-btn danger" data-action="remove-mission-cat" data-idx="'+cIdx+'">✕</button>'+
        '</div>'+
        '<div class="field-grid field-row">'+
          '<div><span class="field-label">Nome</span><input class="field-input" data-scope="missionCat" data-idx="'+cIdx+'" data-field="label" value="'+escapeAttr(cat.label)+'"></div>'+
          '<div><span class="field-label">Emoji</span><input class="field-input" data-scope="missionCat" data-idx="'+cIdx+'" data-field="emoji" value="'+escapeAttr(cat.emoji||'')+'"></div>'+
        '</div>'+
        '<div class="field-row"><span class="field-label">Itens (um por linha)</span><textarea class="field-textarea" data-scope="missionItems" data-idx="'+cIdx+'" data-field="items" data-list="true">'+escapeHTML((cat.items||[]).join('\n'))+'</textarea></div>'+
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
    } else if(scope === 'scene'){
      draft.scenes[idx][field] = value;
      if(field === 'phase'){ renderPreviewAll(); }
    } else if(scope === 'missionCat'){
      draft.missions[idx][field] = value;
    } else if(scope === 'missionItems'){
      draft.missions[idx].items = value;
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

  document.getElementById('addPhaseBtn').addEventListener('click', function(){
    draft.phases.push({ key: 'fase_' + Math.random().toString(36).slice(2, 8), label: 'Nova fase', icon: 'flag' });
    renderPreviewAll();
  });

  document.getElementById('addMissionBtn').addEventListener('click', function(){
    draft.missions.push({ key: 'missao_' + Math.random().toString(36).slice(2, 8), emoji: '✨', label: 'Nova categoria', items: [] });
    renderPreviewMissions();
  });

  document.getElementById('previewBackBtn').addEventListener('click', function(){
    showView('import');
  });

  const publishBtn = document.getElementById('publishBtn');
  publishBtn.addEventListener('click', async function(){
    draft.event_title = document.getElementById('previewEventTitle').value.trim() || 'Evento sem nome';
    if(!draft.scenes.length && !confirm('Publicar sem nenhuma cena? Você pode colar/gerar o roteiro depois, no mesmo link.')){
      return;
    }

    if(!currentUser){
      localStorage.setItem(PENDING_DRAFT_KEY, JSON.stringify({ draft, editingEventId }));
      showView('login');
      loginStatus.textContent = 'Faça login pra publicar — seu roteiro fica salvo e volta pra revisão assim que você entrar.';
      loginStatus.hidden = false;
      return;
    }

    const wasEditing = editingEventId;
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
        body: JSON.stringify(draft)
      });
      const result = await resp.json();
      if(!resp.ok){
        throw new Error(result.error || 'Erro ao salvar o evento.');
      }
      const id = wasEditing || result.id;
      currentOwnerId = currentUser.id;
      editingEventId = null;
      loadChecklist(draft);
      history.pushState({}, '', '/e/' + id);
      showEventLink(id);
    } catch(err){
      alert('Não consegui salvar (' + (err.message || 'erro desconhecido') + ').');
    } finally {
      publishBtn.disabled = false;
      publishBtn.textContent = 'Publicar checklist';
    }
  });

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
    return (
      '<article class="card" id="card-'+item.id+'" data-id="'+item.id+'">'+
        '<span class="vf-corner tl"></span><span class="vf-corner tr"></span>'+
        '<span class="vf-corner bl"></span><span class="vf-corner br"></span>'+
        '<span class="captured-stamp" id="stamp-'+item.id+'">CAPTURADO</span>'+
        '<div class="card-top">'+
          '<div class="card-icon-wrap"><div class="card-icon">'+icon(item.icon)+'</div></div>'+
          '<div class="status-indicator"><span class="dot"></span><span class="check">'+icon('check')+'</span></div>'+
        '</div>'+
        '<h3 class="card-title">'+escapeHTML(item.title)+'</h3>'+
        '<div class="time-row">'+
          '<div class="time-box"><span class="time-label">Cena</span><span class="time-value">'+orderStr+' / '+String(CONTENT.length).padStart(2,'0')+'</span></div>'+
          '<div class="time-box deadline"><span class="time-label">Formato</span><span class="time-value">'+escapeHTML(item.formato)+'</span></div>'+
        '</div>'+
        (captureItems ? '<ul class="capture-list">'+captureItems+'</ul>' : '')+
        speechHTML+
        (rulesHTML ? '<div class="rules-grid">'+rulesHTML+'</div>' : '')+
        '<button class="record-btn" type="button" data-action="toggle" data-id="'+item.id+'">'+
          '<span class="rec-icon"></span><span class="btn-label">Gravar</span>'+
        '</button>'+
      '</article>'
    );
  }

  function loadChecklist(data){
    PHASES = data.phases || [];
    MISSIONS = data.missions || [];

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

    document.getElementById('eventTitle').value = data.event_title || 'Evento sem nome';
    document.getElementById('eventSub').textContent = CONTENT.length + ' cenas · ' + PHASES.length + ' fases — roteiro gerado a partir do texto colado';
    currentEventDate = data.event_date || '';
    currentEventEndDate = data.event_end_date || '';
    currentEventLocation = data.event_location || '';

    render();
    renderMissions();

    if(data.progress){
      Object.entries(data.progress.recorded || {}).forEach(([sceneId, time]) => applyRecord(sceneId, time));
      Object.entries(data.progress.missionsDone || {}).forEach(([key, done]) => { if(done) applyMissionKey(key, true); });
    }

    updateAll();
    updateMissions();

    showView('app');
  }

  function backToImport(){
    showView('import');
    importError.hidden = true;
    hideEventLink();
    disconnectProgressStream();
    currentOwnerId = null;
    editingEventId = null;
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

  function showEventLink(id){
    const row = document.getElementById('eventLinkRow');
    const input = document.getElementById('eventLinkInput');
    const link = window.location.origin + '/e/' + id;
    input.value = link;
    row.hidden = false;
    currentEventId = id;
    connectProgressStream(id);
    updateEditLinkVisibility();

    const calUrl = buildGoogleCalendarUrl(document.getElementById('eventTitle').value, currentEventDate, currentEventEndDate, currentEventLocation, link);
    if(calUrl){
      calendarLinkBtn.href = calUrl;
      calendarLinkBtn.hidden = false;
    } else {
      calendarLinkBtn.hidden = true;
    }
  }

  function updateEditLinkVisibility(){
    if(currentEventId && currentUser && currentOwnerId && currentUser.id === currentOwnerId){
      editEventLink.href = '/e/' + currentEventId + '/editar';
      editEventLink.hidden = false;
    } else {
      editEventLink.hidden = true;
    }
  }

  function hideEventLink(){
    document.getElementById('eventLinkRow').hidden = true;
    calendarLinkBtn.hidden = true;
    currentEventDate = '';
    currentEventEndDate = '';
    currentEventLocation = '';
  }

  // ---------- progresso em tempo real ----------

  function sendProgress(action, payload){
    if(!currentEventId) return;
    fetch('/api/events/' + currentEventId + '/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload })
    }).catch(function(){});
  }

  function connectProgressStream(id){
    if(progressStream) progressStream.close();
    streamHadError = false;
    progressStream = new EventSource('/api/events/' + id + '/stream');
    progressStream.onmessage = function(e){
      let msg;
      try { msg = JSON.parse(e.data); } catch(err){ return; }
      handleRemoteProgress(msg);
    };
    progressStream.onerror = function(){ streamHadError = true; };
    progressStream.onopen = function(){
      if(streamHadError){
        streamHadError = false;
        resyncProgress(id);
      }
    };
  }

  function disconnectProgressStream(){
    if(progressStream){ progressStream.close(); progressStream = null; }
    currentEventId = null;
  }

  function handleRemoteProgress(msg){
    const action = msg.action;
    const payload = msg.payload || {};
    if(action === 'record') applyRecord(payload.sceneId, payload.time);
    else if(action === 'unrecord') applyRecord(payload.sceneId, null);
    else if(action === 'mission') applyMissionKey(payload.cat + '-' + payload.idx, true);
    else if(action === 'unmission') applyMissionKey(payload.cat + '-' + payload.idx, false);
    else if(action === 'reset') resetAllProgress();
  }

  function resyncProgress(id){
    fetch('/api/events/' + id).then(function(r){ return r.json(); }).then(function(data){
      if(!data || !data.progress) return;
      resetAllProgress();
      Object.entries(data.progress.recorded || {}).forEach(([sceneId, time]) => applyRecord(sceneId, time));
      Object.entries(data.progress.missionsDone || {}).forEach(([key, done]) => { if(done) applyMissionKey(key, true); });
    }).catch(function(){});
  }

  document.getElementById('copyLinkBtn').addEventListener('click', function(){
    const input = document.getElementById('eventLinkInput');
    const btn = this;
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
  });

  async function loadEventFromUrl(id){
    try {
      const resp = await fetch('/api/events/' + id);
      const data = await resp.json();
      if(!resp.ok){
        throw new Error(data.error || 'Evento não encontrado.');
      }
      currentOwnerId = data.owner_id || null;
      loadChecklist(data);
      showEventLink(id);
    } catch(err){
      importError.textContent = err.message || 'Não consegui carregar esse evento.';
      importError.hidden = false;
      showView('import');
      history.pushState({}, '', '/');
    }
  }

  async function loadEventForEdit(id){
    try {
      const resp = await fetch('/api/events/' + id);
      const data = await resp.json();
      if(!resp.ok){
        throw new Error(data.error || 'Evento não encontrado.');
      }
      draft = normalizeDraft(data);
      editingEventId = id;
      renderPreviewAll();
      showView('preview');
      publishBtn.textContent = 'Salvar alterações';
    } catch(err){
      importError.textContent = err.message || 'Não consegui carregar esse evento pra editar.';
      importError.hidden = false;
      showView('import');
      history.pushState({}, '', '/');
    }
  }

  async function showHistoryView(){
    if(!currentUser){
      showView('login');
      loginStatus.textContent = 'Faça login pra ver seus eventos publicados.';
      loginStatus.hidden = false;
      return;
    }
    historyList.innerHTML = '<div class="history-empty">Carregando…</div>';
    showView('history');
    try {
      const token = await accessToken();
      const resp = await fetch('/api/events', { headers: { Authorization: 'Bearer ' + token } });
      const result = await resp.json();
      if(!resp.ok){
        throw new Error(result.error || 'Erro ao carregar histórico.');
      }
      renderHistoryList(result.events || []);
    } catch(err){
      historyList.innerHTML = '<div class="history-empty">Não consegui carregar seu histórico (' + escapeHTML(err.message || 'erro') + ').</div>';
    }
  }

  function renderHistoryList(events){
    if(!events.length){
      historyList.innerHTML = '<div class="history-empty">Você ainda não publicou nenhum roteiro.</div>';
      return;
    }
    historyList.innerHTML = events.map(function(ev){
      const date = new Date(ev.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const meta = ev.scene_count ? (ev.scene_count + ' cenas · publicado em ' + date) : ('Rascunho, sem roteiro ainda · reservado em ' + date);
      return (
        '<div class="history-card">'+
          '<div>'+
            '<div class="history-title">'+escapeHTML(ev.event_title)+'</div>'+
            '<div class="history-meta">'+meta+'</div>'+
          '</div>'+
          '<div class="history-actions">'+
            '<a class="btn" href="/e/'+encodeURIComponent(ev.id)+'">Ver</a>'+
            '<a class="btn btn-primary" href="/e/'+encodeURIComponent(ev.id)+'/editar">Editar</a>'+
          '</div>'+
        '</div>'
      );
    }).join('');
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
              '<div class="phase-eyebrow">Momento do evento</div>'+
              '<div class="phase-name">'+escapeHTML(phase.label)+'</div>'+
            '</div>'+
            '<div class="phase-count" id="phasecount-'+phase.key+'">0 / '+items.length+'</div>'+
          '</div>'+
          '<div class="cards-grid">'+ items.map(cardHTML).join('') +'</div>'+
        '</section>';

      navHTML +=
        '<a class="phase-pill" id="pill-'+phase.key+'" href="#'+phase.key+'">'+
          icon(phase.icon)+'<span>'+escapeHTML(phase.label)+'</span> <b id="pillcount-'+phase.key+'">0/'+items.length+'</b>'+
        '</a>';
    });

    container.innerHTML = CONTENT.length ? mainHTML : '<div class="history-empty">Este evento ainda não tem roteiro — volte aqui assim que a equipe adicionar.</div>';
    nav.innerHTML = navHTML;
    document.getElementById('totalCount').textContent = CONTENT.length;
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
      const chips = cat.items.map((t,idx)=>
        '<button type="button" class="mission-chip" data-cat="'+escapeAttr(cat.key)+'" data-idx="'+idx+'" data-key="'+escapeAttr(cat.key+'-'+idx)+'">'+escapeHTML(t)+'</button>'
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

  function updateAll(){
    const doneCount = Object.keys(recorded).length;
    const total = CONTENT.length;
    const pct = total ? Math.round((doneCount/total)*100) : 0;

    document.getElementById('doneCount').textContent = doneCount;
    document.getElementById('progressPct').textContent = pct+'%';
    document.getElementById('progressFill').style.width = pct+'%';

    PHASES.forEach(phase=>{
      const items = CONTENT.filter(c=>c.phase===phase.key);
      const doneInPhase = items.filter(c=>recorded[c.id]).length;
      const countEl = document.getElementById('phasecount-'+phase.key);
      const pillCountEl = document.getElementById('pillcount-'+phase.key);
      const pillEl = document.getElementById('pill-'+phase.key);
      if(countEl) countEl.innerHTML = '<b>'+doneInPhase+'</b> / '+items.length;
      if(pillCountEl) pillCountEl.textContent = doneInPhase+'/'+items.length;
      if(pillEl) pillEl.classList.toggle('done', doneInPhase===items.length && items.length>0);
    });

    checkCompletion(doneCount, total);
  }

  function updateMissions(){
    MISSIONS.forEach(cat=>{
      let done = 0;
      cat.items.forEach((t,idx)=>{ if(missionsDone[cat.key+'-'+idx]) done++; });
      const el = document.getElementById('misscount-'+cat.key);
      if(el) el.textContent = done+'/'+cat.items.length;
    });
  }

  function checkCompletion(doneCount, total){
    const banner = document.getElementById('completionBanner');
    if(total>0 && doneCount>0 && doneCount===total){
      const eventName = document.getElementById('eventTitle').value || 'o evento';
      document.getElementById('completionSub').textContent = 'Todas as '+total+' cenas de "'+eventName+'" foram capturadas.';
      banner.classList.add('visible');
    } else {
      banner.classList.remove('visible');
    }
  }

  function applyRecord(id, time){
    const card = document.getElementById('card-'+id);
    const btnLabel = card && card.querySelector('.btn-label');
    const stamp = document.getElementById('stamp-'+id);

    if(time == null){
      delete recorded[id];
      if(card) card.classList.remove('is-done');
      if(btnLabel) btnLabel.textContent = 'Gravar';
      if(stamp) stamp.textContent = 'CAPTURADO';
    } else {
      recorded[id] = time;
      if(card) card.classList.add('is-done');
      if(btnLabel) btnLabel.textContent = 'Gravado · '+time;
      if(stamp) stamp.textContent = 'CAPTURADO · '+time;
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
    Object.keys(recorded).forEach(id => applyRecord(id, null));
    Object.keys(missionsDone).forEach(key => applyMissionKey(key, false));
  }

  function toggleCard(id){
    if(recorded[id]){
      applyRecord(id, null);
      sendProgress('unrecord', { sceneId: id });
    } else {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2,'0');
      const mm = String(now.getMinutes()).padStart(2,'0');
      const stamp_time = hh+':'+mm;
      applyRecord(id, stamp_time);
      sendProgress('record', { sceneId: id, time: stamp_time });
    }
  }

  function toggleMission(cat, idx){
    const key = cat+'-'+idx;
    if(missionsDone[key]){
      applyMissionKey(key, false);
      sendProgress('unmission', { cat, idx });
    } else {
      applyMissionKey(key, true);
      sendProgress('mission', { cat, idx });
    }
  }

  document.addEventListener('click', function(e){
    const recBtn = e.target.closest('[data-action="toggle"]');
    if(recBtn){ toggleCard(recBtn.dataset.id); return; }

    const chip = e.target.closest('.mission-chip');
    if(chip){ toggleMission(chip.dataset.cat, Number(chip.dataset.idx)); return; }

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
      } else if(action === 'add-scene'){
        const phaseIdx = Number(structBtn.dataset.phaseIdx);
        const phase = draft.phases[phaseIdx];
        draft.scenes.push({ id: 'cena_' + Math.random().toString(36).slice(2, 8), phase: phase.key, title: 'Nova cena', icon: 'flag', formato: 'Story ao vivo', capture: [], speech: '', can: [], cannot: [] });
        renderPreviewAll();
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

  function tickClock(){
    const now = new Date();
    document.getElementById('clockText').textContent = now.toLocaleTimeString('pt-BR', {hour12:false});
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ---------- relatório pós-evento ----------

  function generateReport(){
    const eventTitle = document.getElementById('eventTitle').value || 'Evento';
    const total = CONTENT.length;
    const doneCount = Object.keys(recorded).length;
    const pct = total ? Math.round((doneCount/total)*100) : 0;
    const missionTotal = MISSIONS.reduce((sum, cat) => sum + cat.items.length, 0);
    const missionDone = Object.keys(missionsDone).length;
    const generatedAt = new Date().toLocaleString('pt-BR');

    const phasesHTML = PHASES.map(phase => {
      const items = CONTENT.filter(c => c.phase === phase.key);
      if(!items.length) return '';
      const rows = items.map(item => {
        const done = !!recorded[item.id];
        const time = recorded[item.id] || '';
        return (
          '<tr>'+
            '<td class="report-status">'+(done ? '✓' : '—')+'</td>'+
            '<td>'+escapeHTML(item.title)+'</td>'+
            '<td class="report-muted">'+escapeHTML(item.formato)+'</td>'+
            '<td class="report-muted">'+(time ? escapeHTML(time) : '—')+'</td>'+
          '</tr>'
        );
      }).join('');
      return (
        '<h3>'+escapeHTML(phase.label)+'</h3>'+
        '<table class="report-table"><thead><tr><th></th><th>Cena</th><th>Formato</th><th>Capturado às</th></tr></thead><tbody>'+rows+'</tbody></table>'
      );
    }).join('');

    const missionsHTML = MISSIONS.length ? (
      '<h3>Missões (momentos soltos)</h3>'+
      MISSIONS.map(cat => {
        const rows = cat.items.map((t, idx) => {
          const done = !!missionsDone[cat.key + '-' + idx];
          return '<tr><td class="report-status">'+(done ? '✓' : '—')+'</td><td>'+escapeHTML(t)+'</td></tr>';
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

  document.getElementById('newRoteiroBtn').addEventListener('click', function(){
    roteiroInput.value = '';
    backToImport();
  });

  const resetBtn = document.getElementById('resetBtn');
  let confirming = false;
  let confirmTimer = null;
  resetBtn.addEventListener('click', function(){
    if(!confirming){
      confirming = true;
      resetBtn.classList.add('confirming');
      resetBtn.textContent = 'Clique novamente para confirmar';
      confirmTimer = setTimeout(()=>{
        confirming = false;
        resetBtn.classList.remove('confirming');
        resetBtn.textContent = '↺ Reiniciar checklist';
      }, 3000);
    } else {
      clearTimeout(confirmTimer);
      resetAllProgress();
      sendProgress('reset', {});
      confirming = false;
      resetBtn.classList.remove('confirming');
      resetBtn.textContent = '↺ Reiniciar checklist';
    }
  });

  // ---------- autenticação ----------

  function updateAuthUI(){
    authStripLoggedOut.hidden = !!currentUser;
    authStripLoggedIn.hidden = !currentUser;
    if(currentUser) authStripEmail.textContent = currentUser.email || '';
    updateEditLinkVisibility();
  }

  async function accessToken(){
    const { data } = await sb.auth.getSession();
    return data.session ? data.session.access_token : null;
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
    publishBtn.textContent = editingEventId ? 'Salvar alterações' : 'Publicar checklist';
    renderPreviewAll();
    showView('preview');
    return true;
  }

  authStripLoginBtn.addEventListener('click', function(){ showView('login'); });

  loginBackBtn.addEventListener('click', function(){ showView('import'); });

  loginSubmitBtn.addEventListener('click', async function(){
    const email = loginEmailInput.value.trim();
    loginStatus.hidden = true;
    if(!email){
      loginStatus.textContent = 'Digite um email válido.';
      loginStatus.hidden = false;
      return;
    }
    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = 'Enviando…';
    try {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + '/' } });
      loginStatus.textContent = error ? (error.message || 'Erro ao enviar o link.') : 'Link enviado! Confira seu email (' + email + ').';
      loginStatus.hidden = false;
    } finally {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = 'Enviar link de acesso';
    }
  });

  authStripLogoutBtn.addEventListener('click', async function(){
    await sb.auth.signOut();
    history.pushState({}, '', '/');
    showView('import');
  });

  historyNewBtn.addEventListener('click', function(){
    history.pushState({}, '', '/');
    showView('import');
  });

  // ---------- roteamento ----------

  function route(){
    if(restorePendingDraftIfAny()) return;
    const path = window.location.pathname;
    let m;
    if((m = path.match(/^\/e\/([a-zA-Z0-9-]+)\/editar$/))){ loadEventForEdit(m[1]); return; }
    if(path === '/historico'){ showHistoryView(); return; }
    if((m = path.match(/^\/e\/([a-zA-Z0-9-]+)$/))){ loadEventFromUrl(m[1]); return; }
    showView('import');
  }

  window.addEventListener('popstate', route);

  async function initAuth(){
    const cfg = await fetch('/api/config').then(r => r.json());
    sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const { data: { session } } = await sb.auth.getSession();
    currentUser = session?.user || null;
    updateAuthUI();
    sb.auth.onAuthStateChange(function(_evt, session){
      currentUser = session?.user || null;
      updateAuthUI();
      restorePendingDraftIfAny();
    });
    route();
  }

  initAuth();
})();
