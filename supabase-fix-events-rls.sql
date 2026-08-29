-- Fecha os dois furos achados no pentest do Strix (vuln-0001):
--   1) SELECT liberado pra `anon` deixava dar dump da tabela `events` inteira
--      direto no PostgREST, usando a mesma anon key pública que o navegador
--      recebe via /api/config (o server.js agora usa a service role pra
--      buscar um evento público por id — ver GET /api/events/:id).
--   2) UPDATE liberado pra `anon` deixava sobrescrever evento de qualquer
--      dono sem estar logado. O PATCH /api/events/:id já usa o token do
--      usuário autenticado (scopedClient), nunca a anon key crua — então a
--      policy pode (e deve) exigir authenticated + ser o dono.

-- Ajuste os nomes abaixo pros nomes reais das suas policies
-- (confira em Authentication -> Policies -> tabela events).

drop policy if exists "Enable read access for all users" on public.events;
drop policy if exists "public select events" on public.events;

create policy "select own or saved events" on public.events
  for select to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.event_members
      where event_members.event_id = events.id and event_members.user_id = auth.uid()
    )
  );

drop policy if exists "Enable update for users based on owner_id" on public.events;
drop policy if exists "public update events" on public.events;

create policy "update own events" on public.events
  for update to authenticated
  using (
    owner_id = auth.uid()
    or (allow_member_edit and exists (
      select 1 from public.event_members
      where event_members.event_id = events.id and event_members.user_id = auth.uid()
    ))
  );
