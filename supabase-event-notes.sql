-- Bloco de notas compartilhado por evento (feature "Observações"). Campo
-- mutável simples (não é log append-only como event_progress) — quem edita
-- por último vence, mesmo trade-off aceito conscientemente pra manter isso
-- simples (uma caixa de texto só, não um feed de anotações).
--
-- Nenhuma policy nova precisa ser criada: a policy de UPDATE que já existe em
-- `events` ("owner or editor member update events", ver
-- supabase-member-permissions.sql) já exige dono ou membro com can_edit=true
-- pra alterar QUALQUER coluna da linha, `notes` incluída.

alter table events add column if not exists notes text not null default '';
