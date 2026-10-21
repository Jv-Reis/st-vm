// Resumo seguro de um erro para log (Render) e Sentry. Erros de bibliotecas
// HTTP (ex.: google-auth-library/gaxios) carregam a requisição e a resposta
// inteiras: cabeçalho Authorization, refresh_token, client_secret e dados da
// conta Google. Nada disso pode sair do servidor; aqui só passam campos
// técnicos que ajudam a diagnosticar.
export function safeErrorInfo(err) {
  if (err === null || err === undefined) return { message: String(err) };
  if (typeof err !== 'object') return { message: String(err) };
  const info = {
    name: typeof err.name === 'string' ? err.name : undefined,
    message: typeof err.message === 'string' ? err.message : undefined,
    code: typeof err.code === 'string' || typeof err.code === 'number' ? err.code : undefined,
    status: Number.isInteger(err.status) ? err.status : (Number.isInteger(err.response?.status) ? err.response.status : undefined)
  };
  // código de erro da API (ex.: "invalid_grant"), nunca o corpo inteiro
  const apiError = err.response?.data?.error;
  if (typeof apiError === 'string') info.apiError = apiError;
  // erros do Supabase/Postgres trazem detalhes técnicos úteis em texto
  if (typeof err.details === 'string') info.details = err.details;
  if (typeof err.hint === 'string') info.hint = err.hint;
  return Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined && v !== ''));
}
