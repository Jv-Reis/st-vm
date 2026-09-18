-- Execute no SQL Editor do Supabase antes de publicar esta versão.
begin;
-- O organizador é a identidade usada na autorização. Nem editores nem o
-- próprio dono podem trocar essa identidade por PostgREST e herdar concessões.
create function public.calendar_event_identity_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.owner_id is distinct from old.owner_id or new.id is distinct from old.id then
    raise exception 'Não é permitido trocar a identidade ou o dono do evento';
  end if;
  return new;
end $$;
revoke all on function public.calendar_event_identity_guard() from public, anon, authenticated;
create trigger calendar_event_identity before update on public.events
for each row execute function public.calendar_event_identity_guard();

create table public.calendar_permissions (
  recipient_id uuid not null references auth.users(id) on delete cascade,
  organizer_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (recipient_id, organizer_id),
  check (recipient_id <> organizer_id)
);
alter table public.calendar_permissions enable row level security;
grant select, insert, delete on public.calendar_permissions to authenticated;
create policy "recipient reads grants" on public.calendar_permissions for select to authenticated using (recipient_id = auth.uid());
create policy "recipient grants access" on public.calendar_permissions for insert to authenticated with check (recipient_id = auth.uid());
create policy "recipient revokes access" on public.calendar_permissions for delete to authenticated using (recipient_id = auth.uid());

create function public.authorize_calendar_organizer(p_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  if auth.uid() is null then raise exception 'Login necessário'; end if;
  select id into target from auth.users where lower(email) = lower(trim(p_email));
  if target is null or target = auth.uid() then raise exception 'Informe o email de outra pessoa com conta no CAPTURA'; end if;
  insert into calendar_permissions(recipient_id, organizer_id) values(auth.uid(), target) on conflict do nothing;
  return target;
end $$;
revoke all on function public.authorize_calendar_organizer(text) from public, anon;
grant execute on function public.authorize_calendar_organizer(text) to authenticated;

-- Sem FK para events: as referências sobrevivem à exclusão até a limpeza no Google.
create table public.calendar_copies (
  event_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  organizer_id uuid not null references auth.users(id) on delete cascade,
  google_event_id text not null,
  primary key(event_id, user_id)
);
create table public.calendar_sync_queue (
  event_id text primary key,
  revision uuid not null default gen_random_uuid(),
  retry_at timestamptz not null default now(),
  last_error text
);
alter table public.calendar_copies enable row level security;
alter table public.calendar_sync_queue enable row level security;
revoke all on public.calendar_copies, public.calendar_sync_queue from anon, authenticated;
grant all on public.calendar_permissions, public.calendar_copies, public.calendar_sync_queue to service_role;

-- Uma única instância escreve no Google por vez, inclusive durante redeploy.
create table public.calendar_worker_lease (id boolean primary key default true check(id), holder uuid, expires_at timestamptz not null default now());
insert into public.calendar_worker_lease(id) values(true);
alter table public.calendar_worker_lease enable row level security;
revoke all on public.calendar_worker_lease from anon, authenticated;
create function public.calendar_worker_lock(p_holder uuid, p_release boolean default false) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update calendar_worker_lease set holder = case when p_release then null else p_holder end,
    expires_at = case when p_release then clock_timestamp() else clock_timestamp() + interval '2 minutes' end
  where id and (holder = p_holder or (not p_release and expires_at <= clock_timestamp()));
  return found;
end $$;
revoke all on function public.calendar_worker_lock(uuid, boolean) from public, anon, authenticated;
grant execute on function public.calendar_worker_lock(uuid, boolean) to service_role;

create function public.enqueue_calendar_event(p_id text) returns void
language sql security definer set search_path = public as $$
  insert into calendar_sync_queue(event_id) values(p_id)
  on conflict(event_id) do update set revision = gen_random_uuid(), retry_at = now(), last_error = null;
$$;
revoke all on function public.enqueue_calendar_event(text) from public, anon, authenticated;

create function public.calendar_change_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare uid uuid; eid text;
begin
  if tg_table_name = 'events' then
    if tg_op = 'UPDATE' and new.data is not distinct from old.data and new.owner_id is not distinct from old.owner_id then return new; end if;
    perform enqueue_calendar_event(coalesce(new.id, old.id));
  elsif tg_table_name = 'event_members' then
    perform enqueue_calendar_event(coalesce(new.event_id, old.event_id));
    if tg_op = 'UPDATE' and old.event_id is distinct from new.event_id then perform enqueue_calendar_event(old.event_id); end if;
  else
    if tg_table_name = 'calendar_permissions' then uid := coalesce(new.recipient_id, old.recipient_id);
    else
      if tg_op = 'UPDATE' and new.refresh_token_enc is not distinct from old.refresh_token_enc then return new; end if;
      uid := coalesce(new.user_id, old.user_id);
    end if;
    for eid in
      select id from events where owner_id = uid
      union select event_id from event_members where user_id = uid
      union select event_id from calendar_copies where user_id = uid
    loop perform enqueue_calendar_event(eid); end loop;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.calendar_change_trigger() from public, anon, authenticated;
create trigger calendar_events_changed after insert or update or delete on public.events for each row execute function public.calendar_change_trigger();
create trigger calendar_members_changed after insert or update or delete on public.event_members for each row execute function public.calendar_change_trigger();
create trigger calendar_permissions_changed after insert or delete on public.calendar_permissions for each row execute function public.calendar_change_trigger();
create trigger calendar_accounts_changed after insert or update or delete on public.google_calendar_accounts for each row execute function public.calendar_change_trigger();

-- Preserva os eventos existentes do dono, sem recriar.
insert into calendar_copies(event_id, user_id, organizer_id, google_event_id)
select id, owner_id, owner_id, google_calendar_event_id from events where owner_id is not null and google_calendar_event_id is not null;
insert into calendar_sync_queue(event_id) select id from events;
commit;
