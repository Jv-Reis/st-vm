-- Permite o DONO do evento adicionar alguém como membro digitando o email,
-- em vez de depender da pessoa achar o link e clicar em "Salvar nos meus
-- eventos" ela mesma (único jeito que existia até aqui — a policy de INSERT
-- de `event_members` só libera `user_id = auth.uid()`, ou seja, cada um só
-- pode se auto-inserir).
--
-- Uma função só, que faz busca por email + checagem de dono + insert, tudo
-- atômico. Reaproveita `is_event_owner` (já existe, ver
-- supabase-member-permissions.sql) e o trigger
-- `trg_event_members_can_edit_default` (dispara sozinho no insert abaixo,
-- então `can_edit` já nasce certo a partir de `allow_member_edit`, sem
-- duplicar essa lógica aqui).
--
-- `auth.users` não é exposta via PostgREST (por isso o `select ... from
-- auth.users` só funciona aqui dentro, rodando como SECURITY DEFINER — o
-- mesmo motivo pelo qual `server.js` usa a service role, não a anon key, pra
-- resolver email a partir de user_id em outros lugares).
--
-- Retorna o user_id se achou e adicionou; NULL se ninguém com esse email tem
-- conta ainda (server.js decide convidar via Supabase Auth nesse caso).

create or replace function public.add_event_member_by_email(p_event_id text, p_email text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  if not is_event_owner(p_event_id) then
    raise exception 'not event owner';
  end if;

  select id into target_id from auth.users where lower(email) = lower(p_email) limit 1;
  if target_id is null then
    return null;
  end if;

  insert into event_members (event_id, user_id)
  values (p_event_id, target_id)
  on conflict (event_id, user_id) do nothing;

  return target_id;
end;
$$;

revoke execute on function public.add_event_member_by_email(text, text) from public, anon;
grant execute on function public.add_event_member_by_email(text, text) to authenticated;
