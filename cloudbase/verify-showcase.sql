do $verify$
declare affected integer; sid uuid;
begin
  if not (select relrowsecurity from pg_class where oid='public.climb_showcase'::regclass) or not (select relrowsecurity from pg_class where oid='public.climb_profiles'::regclass) then raise exception 'FAIL: RLS not enabled'; end if;
  if has_table_privilege('anon','public.climb_showcase','SELECT') or has_table_privilege('anon','public.climb_profiles','SELECT') then raise exception 'FAIL: anonymous access'; end if;
  if (select public from storage.buckets where id='climb-photos') then raise exception 'FAIL: public bucket'; end if;
  begin
    insert into public.climb_collections(user_id,payload) values ('showcase-check-a','{"gyms":[{"id":"g","name":"测试岩馆"}],"routes":[{"id":"r","name":"测试线路","gymId":"g","grade":"5.10a","photoPath":"showcase-check-a/check.mp4","mediaType":"video/mp4","mediaSize":10,"notes":"PRIVATE"}]}');
    insert into storage.objects(bucket_id,name,owner_id) values ('climb-photos','showcase-check-a/check.mp4','showcase-check-a'),('climb-photos','showcase-check-a/private.mp4','showcase-check-a');
    set local role authenticated;
    perform set_config('request.jwt.claim.sub','showcase-check-a',true);
    insert into public.climb_profiles(user_id,nickname) values ('showcase-check-a','测试昵称');
    insert into public.climb_showcase(owner_id,route_id) values ('showcase-check-a','r') returning id into sid;
    if (select video::text like '%PRIVATE%' from public.climb_showcase where id=sid) then raise exception 'FAIL: private metadata'; end if;
    update public.climb_collections set version=2,payload=jsonb_set(payload,'{gyms,0,name}','"新岩馆"') where user_id='showcase-check-a';
    if (select gym_name from public.climb_showcase where id=sid) <> '新岩馆' then raise exception 'FAIL: gym edit did not sync'; end if;
    perform set_config('request.jwt.claim.sub','showcase-check-b',true);
    if (select count(*) from public.climb_showcase where id=sid) <> 1 then raise exception 'FAIL: member cannot read share'; end if;
    if (select count(*) from public.climb_collections where user_id='showcase-check-a') <> 0 then raise exception 'FAIL: private collection exposed'; end if;
    if (select count(*) from storage.objects where name in ('showcase-check-a/check.mp4','showcase-check-a/private.mp4')) <> 1 then raise exception 'FAIL: exact media sharing'; end if;
    delete from public.climb_showcase where id=sid;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'FAIL: other member revoked share'; end if;
    update public.climb_profiles set nickname='tampered' where user_id='showcase-check-a';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'FAIL: other member changed nickname'; end if;
    perform set_config('request.jwt.claim.sub','showcase-check-a',true);
    delete from public.climb_showcase where id=sid;
    perform set_config('request.jwt.claim.sub','showcase-check-b',true);
    if (select count(*) from storage.objects where name='showcase-check-a/check.mp4') <> 0 then raise exception 'FAIL: revoke did not remove access'; end if;
    reset role;
    raise exception sqlstate 'ZM001' using message='rollback synthetic metadata fixtures';
  exception when sqlstate 'ZM001' then null; end;
end $verify$;
