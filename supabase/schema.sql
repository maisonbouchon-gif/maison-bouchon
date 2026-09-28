-- Maison Bouchon : à coller dans Supabase > SQL Editor, puis « Run ».

-- 1. Le compte autorisé (partagé par vous deux).
create table if not exists public.famille (email text primary key);
insert into public.famille (email) values
  ('maison.bouchon@gmail.com')
on conflict do nothing;
alter table public.famille enable row level security;  -- personne ne la lit depuis l'app

create or replace function public.est_famille() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.famille where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

-- 2. Les données de l'outil (thèmes, devis, dépenses, étapes, financement).
create table if not exists public.docs (
  coll text not null,
  id   text not null,
  data jsonb not null default '{}'::jsonb,
  maj  timestamptz not null default now(),
  primary key (coll, id)
);
alter table public.docs enable row level security;
alter table public.docs replica identity full;

drop policy if exists "famille lit" on public.docs;
drop policy if exists "famille ajoute" on public.docs;
drop policy if exists "famille modifie" on public.docs;
drop policy if exists "famille supprime" on public.docs;
create policy "famille lit"      on public.docs for select to authenticated using (public.est_famille());
create policy "famille ajoute"   on public.docs for insert to authenticated with check (public.est_famille());
create policy "famille modifie"  on public.docs for update to authenticated using (public.est_famille()) with check (public.est_famille());
create policy "famille supprime" on public.docs for delete to authenticated using (public.est_famille());

-- Mises à jour en direct entre vos deux téléphones.
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 3. Les pièces jointes (devis et factures), privées.
insert into storage.buckets (id, name, public) values ('fichiers', 'fichiers', false)
on conflict (id) do nothing;

drop policy if exists "famille fichiers lit" on storage.objects;
drop policy if exists "famille fichiers ajoute" on storage.objects;
drop policy if exists "famille fichiers modifie" on storage.objects;
drop policy if exists "famille fichiers supprime" on storage.objects;
create policy "famille fichiers lit"       on storage.objects for select to authenticated using (bucket_id = 'fichiers' and public.est_famille());
create policy "famille fichiers ajoute"    on storage.objects for insert to authenticated with check (bucket_id = 'fichiers' and public.est_famille());
create policy "famille fichiers modifie"   on storage.objects for update to authenticated using (bucket_id = 'fichiers' and public.est_famille());
create policy "famille fichiers supprime"  on storage.objects for delete to authenticated using (bucket_id = 'fichiers' and public.est_famille());
