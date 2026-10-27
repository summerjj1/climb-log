begin;

create table public.climb_collections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and jsonb_typeof(payload->'gyms') = 'array'
    and jsonb_typeof(payload->'routes') = 'array'
    and octet_length(payload::text) < 10000000
  )
);
alter table public.climb_collections enable row level security;
revoke all on public.climb_collections from anon, authenticated;
grant select, insert, update on public.climb_collections to authenticated;
create policy "climb_select_own" on public.climb_collections
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "climb_insert_own" on public.climb_collections
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "climb_update_own" on public.climb_collections
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('climb-photos', 'climb-photos', false, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
on conflict (id) do nothing;
create policy "climb_photos_select_own" on storage.objects
  for select to authenticated using (
    bucket_id = 'climb-photos' and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
create policy "climb_photos_insert_own" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'climb-photos' and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
create policy "climb_photos_delete_own" on storage.objects
  for delete to authenticated using (
    bucket_id = 'climb-photos' and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
commit;
