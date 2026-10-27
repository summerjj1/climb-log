begin;
drop trigger prepare_climb_share on public.climb_showcase;
create trigger prepare_climb_share before insert or update of route_id on public.climb_showcase for each row execute function public.prepare_climb_share();
create or replace function public.prune_climb_shares() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
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
commit;
