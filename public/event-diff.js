// Comparação entre o rascunho local e a versão atual do servidor, usada na
// tela de conflito de edição. Sem DOM: dá pra testar direto no Node.

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}

const text = v => String(v ?? '').trim();
const list = v => (Array.isArray(v) ? v : []).map(text).filter(Boolean).join(', ');
const yesNo = v => (v ? 'Sim' : 'Não');
const phases = v => (Array.isArray(v) ? v : []).map(p => text(p?.label) || 'Fase').join(', ');
const scenes = v => {
  const arr = Array.isArray(v) ? v : [];
  return arr.length ? arr.length + (arr.length === 1 ? ' cena: ' : ' cenas: ') + arr.map(s => text(s?.title) || 'Cena').join(' · ') : 'Nenhuma cena';
};
const missions = v => (Array.isArray(v) ? v : []).map(m => {
  const items = (Array.isArray(m?.items) ? m.items : []).map(i => text(typeof i === 'string' ? i : i?.text)).filter(Boolean);
  return (text(m?.label) || 'Categoria') + (items.length ? ' (' + items.join(', ') + ')' : '');
}).join('; ');

export const DIFF_FIELDS = [
  ['event_title', 'Nome do evento', text],
  ['event_date', 'Início', text],
  ['event_end_date', 'Término', text],
  ['event_location', 'Local', text],
  ['member_emails', 'Membros da equipe', list],
  ['calendar_guests', 'Convidados do Calendar', list],
  ['allow_member_edit', 'Novos membros podem editar', yesNo],
  ['drive_folders', 'Pastas do Drive', list],
  ['phases', 'Fases', phases],
  ['scenes', 'Cenas', scenes],
  ['missions', 'Missões', missions]
];

// Só campos versionados — notas ficam de fora (edição curta em tempo real).
export function diffEventDrafts(local, remote) {
  const changes = [];
  for (const [key, label, format] of DIFF_FIELDS) {
    const a = local?.[key], b = remote?.[key];
    if (stable(a) === stable(b)) continue;
    let localText = format(a), remoteText = format(b);
    if (localText === remoteText) {
      localText += ' (detalhes diferentes)';
      remoteText += ' (detalhes diferentes)';
    }
    changes.push({ key, label, local: localText || '—', remote: remoteText || '—' });
  }
  return changes;
}

// Texto legível do rascunho, pra copiar antes de recarregar a versão nova.
export function draftToText(draft) {
  const d = draft || {};
  const lines = [];
  lines.push('Evento: ' + (text(d.event_title) || 'Sem nome'));
  if (d.event_date) lines.push('Início: ' + d.event_date);
  if (d.event_end_date) lines.push('Término: ' + d.event_end_date);
  if (d.event_location) lines.push('Local: ' + d.event_location);
  if (list(d.member_emails)) lines.push('Equipe: ' + list(d.member_emails));
  if (list(d.calendar_guests)) lines.push('Convidados: ' + list(d.calendar_guests));
  if (text(d.notes)) lines.push('', 'Observações:', text(d.notes));
  const phaseList = Array.isArray(d.phases) ? d.phases : [];
  const sceneList = Array.isArray(d.scenes) ? d.scenes : [];
  for (const phase of phaseList) {
    lines.push('', '## ' + (text(phase.label) || 'Fase'));
    for (const scene of sceneList.filter(s => s.phase === phase.key)) {
      lines.push('- ' + (text(scene.title) || 'Cena') + (scene.formato ? ' [' + scene.formato + ']' : ''));
      for (const item of scene.capture || []) lines.push('    captar: ' + item);
      if (text(scene.speech)) lines.push('    fala: ' + scene.speech);
      for (const item of scene.can || []) lines.push('    pode: ' + item);
      for (const item of scene.cannot || []) lines.push('    não pode: ' + item);
    }
  }
  const orphan = sceneList.filter(s => !phaseList.some(p => p.key === s.phase));
  if (orphan.length) {
    lines.push('', '## Sem fase');
    for (const scene of orphan) lines.push('- ' + (text(scene.title) || 'Cena'));
  }
  if (missions(d.missions)) lines.push('', 'Missões: ' + missions(d.missions));
  return lines.join('\n');
}
