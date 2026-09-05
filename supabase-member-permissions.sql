-- Permissão de edição por pessoa em `event_members`, em vez do único
-- interruptor `events.allow_member_edit` valendo igual pra todo mundo que
-- salvou o evento. `allow_member_edit` continua existindo, mas passa a
-- significar só "novos membros que salvarem a partir de agora já nascem
-- editores" — quem já salvou antes só muda de permissão se o dono for lá em
-- "Gerenciar equipe" e mudar individualmente.

alter table event_members add column can_edit boolean not null default false;

-- migra o estado atual: quem já tinha allow_member_edit=true no evento vira editor
update event_members em
set can_edit = true
from events e
where e.id = em.event_id and e.allow_member_edit = true;

-- o client nunca escolhe can_edit no insert (evitaria repetir o tipo de IDOR
-- já corrigido antes: nunca confiar em payload do client pra autorização) —
-- esse trigger copia o allow_member_edit do evento pro can_edit do membro
-- assim que ele salva, ignorando qualquer valor mandado no payload.
create or replace function public.set_event_member_can_edit_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.can_edit := coalesce((select allow_member_edit from events where id = new.event_id), false);
  return new;
end;
$$;

-- só roda como trigger — nunca deve ser chamável direto via RPC
revoke execute on function public.set_event_member_can_edit_default() from public, anon, authenticated;

drop trigger if exists trg_event_members_can_edit_default on event_members;
create trigger trg_event_members_can_edit_default
before insert on event_members
for each row execute function set_event_member_can_edit_default();

-- Postgres RLS reavalia a policy da tabela referenciada dentro de um EXISTS,
-- então `event_members` consultando `events` (pra achar o dono) e `events`
-- consultando `event_members` (pra achar quem edita) causam recursão infinita
-- (42P17) se as duas policies usarem subquery direta uma na outra. Essa
-- função SECURITY DEFINER quebra o ciclo: como ela roda com o dono da função
-- (bypassa RLS por dentro), a consulta que ela faz em `events` não reaciona a
-- policy de SELECT de `events`, que é o que fechava o loop.
create or replace function public.is_event_owner(p_event_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from events where id = p_event_id and owner_id = auth.uid());
$$;

revoke execute on function public.is_event_owner(text) from public, anon;
grant execute on function public.is_event_owner(text) to authenticated;

-- owner precisa enxergar e atualizar a permissão de cada membro do próprio
-- evento (antes só existia "select own memberships", que não cobre o dono
-- vendo os outros)
create policy "owner selects event members" on event_members
for select to authenticated
using (is_event_owner(event_id));

create policy "owner updates member can_edit" on event_members
for update to authenticated
using (is_event_owner(event_id))
with check (is_event_owner(event_id));

-- events.UPDATE passa a checar can_edit por pessoa, não mais o interruptor global
drop policy if exists "owner or allowed member update events" on events;
drop policy if exists "update own events" on events;

create policy "owner or editor member update events" on events
for update to authenticated
using (
  owner_id = auth.uid()
  or exists (
    select 1 from event_members em
    where em.event_id = events.id and em.user_id = auth.uid() and em.can_edit = true
  )
);
