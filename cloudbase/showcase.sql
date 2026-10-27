begin;
create table if not exists public.climb_profiles (
  user_id text primary key default auth.uid()::text,
  nickname text not null check (char_length(btrim(nickname)) between 1 and 24 and nickname = btrim(nickname))
);
alter table public.climb_profiles enable row level security;
revoke all on public.climb_profiles from anon, authenticated;
grant select, insert, update on public.climb_profiles to authenticated;
create policy profiles_read_members on public.climb_profiles for select to authenticated using (true);
create policy profiles_insert_own on public.climb_profiles for insert to authenticated with check (user_id = (select auth.uid()::text));
create policy profiles_update_own on public.climb_profiles for update to authenticated using (user_id = (select auth.uid()::text)) with check (user_id = (select auth.uid()::text));

create table public.climb_showcase (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references public.climb_profiles(user_id),
  route_id text not null check (char_length(route_id) between 1 and 80),
  title text not null,
  gym_name text not null,
  grade text not null,
  poster text not null default '',
  video jsonb not null,
  media_paths text[] not null,
  created_at timestamptz not null default now(),
  unique(owner_id, route_id)
);
create index showcase_feed_order on public.climb_showcase(created_at desc,id desc);
create index showcase_media_paths on public.climb_showcase using gin(media_paths);
alter table public.climb_showcase enable row level security;
revoke all on public.climb_showcase from anon, authenticated;
grant select, delete on public.climb_showcase to authenticated;
grant insert(owner_id,route_id), update(route_id) on public.climb_showcase to authenticated;
create policy showcase_read_members on public.climb_showcase for select to authenticated using (true);
create policy showcase_insert_own on public.climb_showcase for insert to authenticated with check (owner_id = (select auth.uid()::text));
create policy showcase_update_own on public.climb_showcase for update to authenticated using (owner_id = (select auth.uid()::text)) with check (owner_id = (select auth.uid()::text));
create policy showcase_delete_own on public.climb_showcase for delete to authenticated using (owner_id = (select auth.uid()::text));

-- Build the shared snapshot on the server from the owner's saved record. Clients
-- cannot choose another owner's paths or publish email/private notes in metadata.
create function public.prepare_climb_share() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare collection jsonb; r jsonb; mime text;
begin
  if new.owner_id is distinct from auth.uid()::text then raise exception 'not owner' using errcode='42501'; end if;
  select payload into collection from public.climb_collections where user_id = new.owner_id for share;
  select item into r from jsonb_array_elements(collection->'routes') item where item->>'id' = new.route_id;
  mime := coalesce(r->>'mediaType',r->'photoParts'->>'type',case when r->>'photoPath' ~ '\.mp4$' then 'video/mp4' when r->>'photoPath' ~ '\.mov$' then 'video/quicktime' when r->>'photoPath' ~ '\.webm$' then 'video/webm' end);
  if r is null or mime not in ('video/mp4','video/quicktime','video/webm') or mime is null then raise exception 'saved video required'; end if;
  new.title := left(coalesce(r->>'name','攀爬视频'),80);
  new.grade := left(coalesce(r->>'grade',''),20);
  new.gym_name := left(coalesce((select g->>'name' from jsonb_array_elements(collection->'gyms') g where g->>'id'=r->>'gymId' limit 1),'未命名岩馆'),80);
  new.poster := case when length(r->>'poster') < 200000 and r->>'poster' ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' then r->>'poster' else '' end;
  new.video := jsonb_strip_nulls(jsonb_build_object('photoPath',r->'photoPath','photoParts',r->'photoParts','mediaType',mime,'mediaSize',r->'mediaSize','videoMeta',jsonb_strip_nulls(jsonb_build_object('duration',r->'videoMeta'->'duration','fastCompressed',r->'videoMeta'->'fastCompressed'))));
  if jsonb_typeof(r->'photoParts') = 'object' then
    select array_agg(part->>'path' order by ordinal) into new.media_paths from jsonb_array_elements(r->'photoParts'->'parts') with ordinality p(part,ordinal);
  else new.media_paths := array[r->>'photoPath']; end if;
  if new.media_paths is null or cardinality(new.media_paths) not between 1 and 256 or exists (
    select 1 from unnest(new.media_paths) path where path is null or split_part(path,'/',1) <> new.owner_id or path ~ '(^|/)\.{1,2}(/|$)' or position(chr(92) in path)>0
  ) then raise exception 'invalid media paths'; end if;
  return new;
end $$;
revoke all on function public.prepare_climb_share() from public;
create trigger prepare_climb_share before insert or update of route_id on public.climb_showcase for each row execute function public.prepare_climb_share();

-- Sharing grants read access only to the exact published objects, to signed-in
-- users. Existing owner-only insert/delete policies and private bucket stay intact.
create policy climb_photos_read_shared on storage.objects for select to authenticated using (
  bucket_id = 'climb-photos' and exists (select 1 from public.climb_showcase s where s.media_paths @> array[storage.objects.name])
);

create function public.prune_climb_shares() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    delete from public.climb_showcase where owner_id = old.user_id;
  else
    delete from public.climb_showcase s where s.owner_id = old.user_id and not exists (
      select 1 from jsonb_array_elements(new.payload->'routes') r where r->>'id' = s.route_id
      and r->>'photoPath' = s.video->>'photoPath'
      and (r->'photoParts') is not distinct from (s.video->'photoParts')
    );
    update public.climb_showcase s set
      title = left(coalesce(r->>'name','攀爬视频'),80),
      grade = left(coalesce(r->>'grade',''),20),
      gym_name = left(coalesce((select g->>'name' from jsonb_array_elements(new.payload->'gyms') g where g->>'id'=r->>'gymId' limit 1),'未命名岩馆'),80)
    from jsonb_array_elements(new.payload->'routes') r
    where s.owner_id = old.user_id and s.route_id = r->>'id';
  end if;
  return null;
end $$;
revoke all on function public.prune_climb_shares() from public;
create trigger prune_climb_shares after update or delete on public.climb_collections for each row execute function public.prune_climb_shares();
commit;
