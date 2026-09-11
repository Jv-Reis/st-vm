-- Dono pode excluir seu próprio evento. `event_members` e `event_progress`
-- já têm ON DELETE CASCADE nas FKs pra events(id) (ver
-- supabase-member-permissions.sql / supabase-event-progress.sql), então
-- apagar a linha aqui já limpa tudo relacionado sozinho — não precisa de
-- nenhuma policy de DELETE nessas duas tabelas (o cascade disparado pelo
-- Postgres não passa pela RLS de quem iniciou o DELETE original).
--
-- Não apaga o evento correspondente no Google Calendar nem a pasta no
-- Google Drive, se existirem — ficam órfãos lá. Fora de escopo por ora.

create policy "owner deletes own events" on public.events
  for delete to authenticated
  using (owner_id = auth.uid());
