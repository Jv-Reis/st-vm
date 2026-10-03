// Navegação do checklist ao vivo: o que conta como pendente e qual é a
// "próxima cena". Sem DOM, pra testar direto no Node (mesmo padrão do
// progress-time.js).

// Em andamento ainda é pendente: só Feito e Postado contam como capturada.
export function isPendingStatus(status) {
  return status !== 'feito' && status !== 'postado';
}

export function countPending(ids, statusOf) {
  return ids.filter((id) => isPendingStatus(statusOf(id))).length;
}

// Próxima cena pendente depois de `currentId`, na ordem do roteiro. Se não
// houver nenhuma depois, volta ao começo; a própria cena atual é a última
// opção (quando é a única que falta). Sem pendentes, devolve null.
export function nextPendingId(ids, statusOf, currentId) {
  if (!ids.length) return null;
  const start = ids.indexOf(currentId);
  for (let step = 1; step <= ids.length; step++) {
    const id = ids[(Math.max(start, -1) + step + ids.length) % ids.length];
    if (isPendingStatus(statusOf(id))) return id;
  }
  return null;
}
