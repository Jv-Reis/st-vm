// Recebe dados já normalizados. Só o conteúdo do roteiro pode substituir o
// rascunho existente; metadados e vínculos continuam pertencendo ao evento.
export function mergeGeneratedRoteiro(existing, generated, newId = () => crypto.randomUUID()) {
  if (!existing) return generated;
  return {
    ...existing,
    phases: generated.phases,
    scenes: generated.scenes.map(scene => ({ ...scene, id: 'cena_' + newId() })),
    missions: generated.missions.map(mission => ({
      ...mission, key: 'missao_' + newId(),
      items: mission.items.map(item => ({ ...item, key: 'item_' + newId() }))
    }))
  };
}

export function hasRoteiro(draft) {
  return !!(draft && (draft.scenes?.length || draft.phases?.length || draft.missions?.length));
}
