create table if not exists public.manifestation_sync (
  sync_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.manifestation_sync enable row level security;

drop policy if exists "allow authenticated read sync data" on public.manifestation_sync;
drop policy if exists "allow authenticated insert sync data" on public.manifestation_sync;
drop policy if exists "allow authenticated update sync data" on public.manifestation_sync;

create policy "allow authenticated read sync data"
on public.manifestation_sync
for select
to authenticated
using (true);

create policy "allow authenticated insert sync data"
on public.manifestation_sync
for insert
to authenticated
with check (true);

create policy "allow authenticated update sync data"
on public.manifestation_sync
for update
to authenticated
using (true)
with check (true);
