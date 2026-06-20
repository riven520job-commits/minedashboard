create table if not exists public.manifestation_sync (
  sync_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.manifestation_sync enable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on table public.manifestation_sync to anon, authenticated, service_role;

drop policy if exists "allow anon read sync data" on public.manifestation_sync;
drop policy if exists "allow anon insert sync data" on public.manifestation_sync;
drop policy if exists "allow anon update sync data" on public.manifestation_sync;

create policy "allow anon read sync data"
on public.manifestation_sync
for select
to anon
using (true);

create policy "allow anon insert sync data"
on public.manifestation_sync
for insert
to anon
with check (true);

create policy "allow anon update sync data"
on public.manifestation_sync
for update
to anon
using (true)
with check (true);
