// Validação do payload de progresso (POST /api/events/:id/progress e
// /api/share/:token/progress). O servidor guardava o que chegava, sem olhar:
// até 1 MB por chamada, de qualquer pessoa com um link de colaboração. Aqui
// cada ação tem uma lista fixa de campos; o resultado é reconstruído só com
// eles (campo extra é descartado, não vira erro) e é isso que vai pro banco e
// pro tempo real.
//
// Horários aceitos: ISO completo (o formato atual, com data) e HH:MM (o formato
// antigo, que ainda existe no banco e em telas com o app desatualizado). Não
// há checagem de "perto de agora" de propósito: celular com o relógio errado
// perderia todas as ações da fila offline.

export const STATUSES = ['nao_iniciado', 'andamento', 'feito', 'postado'];

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const LEGACY_TIME_RE = /^\d{1,2}:\d{2}$/;
const MAX_IDX = 9999;

const fail = (error) => ({ ok: false, error });

function cleanId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  return typeof value === 'string' && ID_RE.test(value) ? value : undefined;
}

// undefined = inválido; null = ausente
function cleanStamp(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  if (ISO_RE.test(value) && Number.isFinite(Date.parse(value))) return value;
  if (LEGACY_TIME_RE.test(value)) return value;
  return undefined;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function sanitizeProgressPayload(action, payload) {
  const source = payload === undefined || payload === null ? {} : payload;
  if (!isObject(source)) return fail('Formato de progresso inválido.');

  if (action === 'reset') return { ok: true, payload: {} };

  if (action === 'status') {
    const sceneId = cleanId(source.sceneId);
    if (sceneId === undefined) return fail('Cena inválida.');
    if (!STATUSES.includes(source.status)) return fail('Status inválido.');
    const andamentoAt = cleanStamp(source.andamentoAt);
    const feitoAt = cleanStamp(source.feitoAt);
    const postadoAt = cleanStamp(source.postadoAt);
    if (andamentoAt === undefined || feitoAt === undefined || postadoAt === undefined) return fail('Horário inválido.');
    return { ok: true, payload: { sceneId, status: source.status, andamentoAt, feitoAt, postadoAt } };
  }

  // ações antigas, de antes do status em 4 níveis (ainda aceitas de telas desatualizadas)
  if (action === 'record') {
    const sceneId = cleanId(source.sceneId);
    if (sceneId === undefined) return fail('Cena inválida.');
    const time = cleanStamp(source.time);
    if (time === undefined) return fail('Horário inválido.');
    return { ok: true, payload: { sceneId, time } };
  }
  if (action === 'unrecord') {
    const sceneId = cleanId(source.sceneId);
    if (sceneId === undefined) return fail('Cena inválida.');
    return { ok: true, payload: { sceneId } };
  }

  if (action === 'mission' || action === 'unmission') {
    const cat = cleanId(source.cat);
    if (cat === undefined) return fail('Categoria inválida.');
    if (source.itemKey !== undefined && source.itemKey !== null) {
      const itemKey = cleanId(source.itemKey);
      if (itemKey === undefined) return fail('Item inválido.');
      return { ok: true, payload: { cat, itemKey } };
    }
    if (!Number.isInteger(source.idx) || source.idx < 0 || source.idx > MAX_IDX) return fail('Item inválido.');
    return { ok: true, payload: { cat, idx: source.idx } };
  }

  return fail('Ação de progresso inválida.');
}
