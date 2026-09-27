-- Controle de acesso — etapa 2 de 2. Execute DEPOIS que o servidor novo
-- estiver no ar (ele não depende destas permissões). A versão anterior do
-- servidor gravava progresso com a anon key e quebraria com isto aplicado.
begin;

-- ---------------------------------------------------------------------------
-- Fecha acessos diretos pelo PostgREST que ignoravam o servidor
-- A anon key é pública (vai pro navegador). Com ela, qualquer pessoa lia e
-- gravava progresso de qualquer evento, e qualquer conta se inseria como
-- membro de qualquer evento pelo ID. Agora progresso só passa pelo servidor,
-- que confere o modo de acesso; entrar na equipe só por join_shared_event
-- ou convite do dono.
-- ---------------------------------------------------------------------------
drop policy if exists "public insert progress" on public.event_progress;
drop policy if exists "public select progress" on public.event_progress;
revoke all on public.event_progress from anon, authenticated;
grant all on public.event_progress to service_role;

drop policy if exists "user inserts own membership" on public.event_members;

commit;
