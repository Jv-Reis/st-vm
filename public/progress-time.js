// Horários do progresso das cenas (iniciado / concluído / postado). Sem DOM,
// pra testar direto no Node (mesmo padrão do event-diff.js).
//
// Formato atual: ISO completo, com data ("2026-09-29T18:00:00.000Z"). Sem a data
// não dá pra medir a demora entre "Feito" e "Postado", que costuma levar dias.
// Registros antigos guardaram só "HH:MM": continuam aparecendo, mas sem data
// não dá pra calcular demora com eles.

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const LEGACY_RE = /^\d{1,2}:\d{2}$/;

const pad = (n) => String(n).padStart(2, '0');

export function nowStamp(now = new Date()) {
  return now.toISOString();
}

export function isFullStamp(value) {
  return typeof value === 'string' && ISO_RE.test(value) && Number.isFinite(Date.parse(value));
}

export function isLegacyStamp(value) {
  return typeof value === 'string' && LEGACY_RE.test(value);
}

function clock(date) {
  return pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Como aparece no card: "10:00" se for hoje, "12/10 10:00" se for de outro dia.
export function formatStamp(value, now = new Date()) {
  if (isLegacyStamp(value)) return value;
  if (!isFullStamp(value)) return value ? String(value) : '';
  const date = new Date(value);
  if (sameLocalDay(date, now)) return clock(date);
  return pad(date.getDate()) + '/' + pad(date.getMonth() + 1) + ' ' + clock(date);
}

// Como aparece no relatório: sempre com a data, porque ele é lido depois.
export function formatStampFull(value) {
  if (isLegacyStamp(value)) return value;
  if (!isFullStamp(value)) return value ? String(value) : '';
  const date = new Date(value);
  return pad(date.getDate()) + '/' + pad(date.getMonth() + 1) + ' ' + clock(date);
}

// Demora entre dois horários: "23min", "2h05", "1d 16h". Só calcula quando os
// dois têm data. Com "HH:MM" antigo, ou se a ordem estiver invertida (o status
// voltou de "Postado" pra "Feito"), devolve null: o relatório mostra "—" em vez
// de um número que pode estar errado.
export function formatDelay(from, to) {
  if (!isFullStamp(from) || !isFullStamp(to)) return null;
  const diff = Date.parse(to) - Date.parse(from);
  if (diff < 0) return null;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return minutes + 'min';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h' + pad(minutes % 60);
  return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h';
}
