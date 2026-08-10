create table if not exists event_progress (
  id bigint generated always as identity primary key,
  event_id text not null references events(id) on delete cascade,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table event_progress enable row level security;

create policy "public insert progress" on event_progress
  for insert to anon with check (true);

create policy "public select progress" on event_progress
  for select to anon using (true);
