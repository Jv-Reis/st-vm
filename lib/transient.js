// Falhas passageiras de infraestrutura (gateway do Supabase, rede) nos workers
// em segundo plano. Eles rodam a cada 15-20s e tentam de novo sozinhos; um
// soluço de 1-2 minutos não é bug e não deve virar issue no Sentry.

const GATEWAY_MESSAGE = /^(bad gateway|gateway timeout|service unavailable)$/i;
const NETWORK_MESSAGE = /fetch failed|socket hang up|econnreset|etimedout|econnrefused|connect timeout/i;
const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);

// Erros do Supabase/PostgREST não são instância de Error: chegam como objeto
// { message: 'Gateway Timeout' } sem status, então o texto também conta.
export function isTransientGatewayError(err) {
  if (!err) return false;
  const status = Number(err.status ?? err.statusCode);
  if (status === 502 || status === 503 || status === 504) return true;
  if (NETWORK_CODES.has(err.code) || NETWORK_CODES.has(err.cause?.code)) return true;
  const message = String(err.message ?? '').trim();
  return GATEWAY_MESSAGE.test(message) || NETWORK_MESSAGE.test(message);
}

// Mesma assinatura do logError, pra trocar direto nos workers. Erro que não é
// passageiro vai pro logError na hora. Passageiro vira só aviso no log, até
// durar `thresholdMs` seguidos (falhas com intervalo menor que `gapMs` contam
// como a mesma queda); aí avisa uma vez por queda.
export function createWorkerLogger({ logError, warn = console.warn, now = Date.now, thresholdMs = 5 * 60000, gapMs = 90000 }) {
  const streaks = new Map(); // mensagem -> { firstAt, lastAt, reported }
  return function logWorkerError(message, err) {
    if (!isTransientGatewayError(err)) return logError(message, err);
    const t = now();
    let streak = streaks.get(message);
    if (!streak || t - streak.lastAt > gapMs) {
      streak = { firstAt: t, lastAt: t, reported: false };
      streaks.set(message, streak);
    }
    streak.lastAt = t;
    if (!streak.reported && t - streak.firstAt >= thresholdMs) {
      streak.reported = true;
      return logError(`${message} (falhando há ${Math.round((t - streak.firstAt) / 60000)} min)`, err);
    }
    warn(message, err?.message ?? String(err), '(instabilidade passageira, sem alerta)');
  };
}
