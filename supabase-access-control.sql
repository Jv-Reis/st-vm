-- Controle de acesso, links revogáveis, versão do evento e fila de convites.
-- Etapa 1 de 2. Execute uma vez no SQL Editor do Supabase ANTES de publicar
-- esta versão do servidor. Só adiciona (colunas, tabelas, funções): a versão
-- anterior do servidor continua funcionando com ela aplicada.
-- Depois do deploy, execute supabase-access-control-lockdown.sql (etapa 2).
-- Requer as migrações anteriores (membros, calendar, exclusão).
begin;

-- Ordem de travas igual à migração do Calendar (events primeiro), para não
-- disputar travas com ela.
lock table public.events in share row exclusive mode;

-- ---------------------------------------------------------------------------
-- 1. Versão do evento (controle otimista contra edição simultânea)
-- Só roteiro, datas, equipe e configurações contam como versão. Notas ficam
-- fora: continuam sendo edição curta em tempo real, sem bloqueio.
-- ---------------------------------------------------------------------------
alter table public.events add column revision integer not null default 1;

create function public.bump_event_revision() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.data is distinct from old.data
     or new.allow_member_edit is distinct from old.allow_member_edit
     or new.drive_folder_id is distinct from old.drive_folder_id then
    new.revision := old.revision + 1;
  else
    -- o cliente nunca escolhe a versão diretamente
    new.revision := old.revision;
  end if;
  return new;
end $$;
revoke all on function public.bump_event_revision() from public, anon, authenticated;
create trigger events_revision before update on public.events
for each row execute function public.bump_event_revision();

-- ---------------------------------------------------------------------------
-- 2. Modo de acesso e link compartilhável revogável
-- O link público usa um token aleatório próprio, nunca o ID do evento. Só o
-- dono lê o token (RLS); editores e visitantes não conseguem vê-lo nem trocá-lo.
-- ---------------------------------------------------------------------------
create table public.event_access (
  event_id text primary key references public.events(id) on delete cascade,
  share_mode text not null default 'collab' check (share_mode in ('team', 'view', 'collab')),
  share_token text unique check (share_token is null or length(share_token) >= 32),
  token_created_at timestamptz,
  -- links antigos /e/<id> continuam abrindo sem login até essa data (só para
  -- eventos criados antes desta migração). Qualquer mudança explícita de
  -- compartilhamento encerra esse período.
  legacy_link_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.event_access enable row level security;
revoke all on public.event_access from anon, authenticated;
grant select on public.event_access to authenticated;
create policy "owner reads event access" on public.event_access
  for select to authenticated using (is_event_owner(event_id));
grant all on public.event_access to service_role;

create function public.new_share_token() returns text
language sql volatile set search_path = public, extensions as $$
  select translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
$$;
revoke all on function public.new_share_token() from public, anon, authenticated;

-- Todo evento novo nasce com linha de acesso (link para colaborar, igual ao
-- comportamento que o produto sempre teve), sem período de link antigo.
create function public.event_access_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into event_access(event_id, share_mode, share_token, token_created_at)
  values (new.id, 'collab', new_share_token(), now())
  on conflict (event_id) do nothing;
  return new;
end $$;
revoke all on function public.event_access_on_insert() from public, anon, authenticated;
create trigger event_access_created after insert on public.events
for each row execute function public.event_access_on_insert();

create function public.set_event_share_mode(p_event_id text, p_mode text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_event_owner(p_event_id) then raise exception 'not event owner'; end if;
  if p_mode is null or p_mode not in ('team', 'view', 'collab') then raise exception 'invalid share mode'; end if;
  update event_access
     set legacy_link_until = case when share_mode <> p_mode then null else legacy_link_until end,
         share_mode = p_mode, updated_at = now()
   where event_id = p_event_id;
  if not found then
    insert into event_access(event_id, share_mode, share_token, token_created_at)
    values (p_event_id, p_mode, new_share_token(), now());
  end if;
end $$;

create function public.regenerate_event_share_token(p_event_id text) returns text
language plpgsql security definer set search_path = public as $$
declare t text := new_share_token();
begin
  if not is_event_owner(p_event_id) then raise exception 'not event owner'; end if;
  update event_access
     set share_token = t, token_created_at = now(), legacy_link_until = null, updated_at = now()
   where event_id = p_event_id;
  if not found then
    insert into event_access(event_id, share_token, token_created_at) values (p_event_id, t, now());
  end if;
  return t;
end $$;

create function public.disable_event_share_link(p_event_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_event_owner(p_event_id) then raise exception 'not event owner'; end if;
  update event_access
     set share_token = null, token_created_at = null, legacy_link_until = null, updated_at = now()
   where event_id = p_event_id;
end $$;

-- Entrar na equipe pelo link só vale no modo "colaborar" (quem só pode
-- visualizar não vira membro sozinho). Pelo ID, só durante o período do link antigo.
create function public.join_shared_event(p_token text default null, p_event_id text default null) returns text
language plpgsql security definer set search_path = public as $$
declare a event_access;
begin
  if auth.uid() is null then raise exception 'Login necessário'; end if;
  if p_token is not null then
    select * into a from event_access where share_token = p_token;
  elsif p_event_id is not null then
    select * into a from event_access where event_id = p_event_id and legacy_link_until > now();
  end if;
  if a.event_id is null or a.share_mode <> 'collab' then raise exception 'join not allowed'; end if;
  if exists (select 1 from events where id = a.event_id and owner_id = auth.uid()) then return a.event_id; end if;
  insert into event_members(event_id, user_id) values (a.event_id, auth.uid()) on conflict do nothing;
  return a.event_id;
end $$;

revoke all on function public.set_event_share_mode(text, text) from public, anon;
revoke all on function public.regenerate_event_share_token(text) from public, anon;
revoke all on function public.disable_event_share_link(text) from public, anon;
revoke all on function public.join_shared_event(text, text) from public, anon;
grant execute on function public.set_event_share_mode(text, text) to authenticated;
grant execute on function public.regenerate_event_share_token(text) to authenticated;
grant execute on function public.disable_event_share_link(text) to authenticated;
grant execute on function public.join_shared_event(text, text) to authenticated;

-- Eventos existentes: mesmo acesso de hoje (link para colaborar), com os
-- links antigos /e/<id> funcionando por mais 60 dias.
insert into public.event_access(event_id, share_mode, share_token, token_created_at, legacy_link_until)
select id, 'collab', public.new_share_token(), now(), now() + interval '60 days' from public.events
on conflict (event_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Convites de membros: estado persistente e tentativas
-- O dono enfileira (RLS/RPC confere a posse); o servidor processa com a
-- service role, inclusive depois de reiniciar.
-- ---------------------------------------------------------------------------
create table public.event_member_invites (
  event_id text not null references public.events(id) on delete cascade,
  email text not null check (email = lower(email)),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'added', 'existing', 'invited', 'failed')),
  attempts integer not null default 0,
  last_error text,
  user_id uuid references auth.users(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  next_attempt_at timestamptz not null default now(),
  claimed_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, email)
);
create index event_member_invites_due on public.event_member_invites (next_attempt_at)
  where status in ('pending', 'processing');
alter table public.event_member_invites enable row level security;
revoke all on public.event_member_invites from anon, authenticated;
grant select on public.event_member_invites to authenticated;
create policy "owner reads member invites" on public.event_member_invites
  for select to authenticated using (is_event_owner(event_id));
grant all on public.event_member_invites to service_role;

-- Reenviar o mesmo email não duplica. Um convite que falhou só volta pra fila
-- quando pedido explicitamente (p_retry_failed ou retry_failed_member_invites).
create function public.enqueue_member_invites(p_event_id text, p_emails text[], p_retry_failed boolean default false)
returns setof public.event_member_invites
language plpgsql security definer set search_path = public as $$
begin
  if not is_event_owner(p_event_id) then raise exception 'not event owner'; end if;
  insert into event_member_invites(event_id, email, requested_by)
  select p_event_id, e, auth.uid()
    from (select distinct lower(trim(x)) as e from unnest(p_emails) as x) s
   where e ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  on conflict (event_id, email) do update
     set status = 'pending', attempts = 0, last_error = null, next_attempt_at = now(),
         claimed_until = null, updated_at = now(), requested_by = auth.uid()
   where p_retry_failed and event_member_invites.status = 'failed';
  return query
    select * from event_member_invites
     where event_id = p_event_id
       and email = any (select lower(trim(x)) from unnest(p_emails) as x);
end $$;

create function public.retry_failed_member_invites(p_event_id text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not is_event_owner(p_event_id) then raise exception 'not event owner'; end if;
  update event_member_invites
     set status = 'pending', attempts = 0, last_error = null, next_attempt_at = now(),
         claimed_until = null, updated_at = now()
   where event_id = p_event_id and status = 'failed';
  get diagnostics n = row_count;
  return n;
end $$;

-- Reserva lotes para processamento. Uma reserva expirada (servidor reiniciou
-- no meio) volta a ser elegível; "skip locked" evita duas instâncias pegarem
-- o mesmo convite.
create function public.claim_member_invites(p_limit integer, p_event_id text default null)
returns setof public.event_member_invites
language sql security definer set search_path = public as $$
  update event_member_invites i
     set status = 'processing', claimed_until = now() + interval '2 minutes',
         attempts = i.attempts + 1, updated_at = now()
   where (i.event_id, i.email) in (
     select event_id, email from event_member_invites
      where next_attempt_at <= now()
        and (status = 'pending' or (status = 'processing' and claimed_until < now()))
        and (p_event_id is null or event_id = p_event_id)
      order by created_at
      limit greatest(p_limit, 1)
      for update skip locked)
  returning i.*;
$$;

-- auth.users não é exposta pelo PostgREST; só o servidor resolve email -> conta.
create function public.find_user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

revoke all on function public.enqueue_member_invites(text, text[], boolean) from public, anon;
revoke all on function public.retry_failed_member_invites(text) from public, anon;
revoke all on function public.claim_member_invites(integer, text) from public, anon, authenticated;
revoke all on function public.find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.enqueue_member_invites(text, text[], boolean) to authenticated;
grant execute on function public.retry_failed_member_invites(text) to authenticated;
grant execute on function public.claim_member_invites(integer, text) to service_role;
grant execute on function public.find_user_id_by_email(text) to service_role;

commit;
