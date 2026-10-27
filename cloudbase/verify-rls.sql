do $verify$ declare affected integer; begin begin
insert into public.climb_collections (user_id, payload) values
  ('b32fca61-188a-44e0-8e33-52c6cb251d01', '{"gyms":[],"routes":[]}'),
  ('b32fca61-188a-44e0-8e33-52c6cb251d02', '{"gyms":[],"routes":[]}');
set local role authenticated;
perform set_config('request.jwt.claim.sub', 'b32fca61-188a-44e0-8e33-52c6cb251d01', true);

  if (select count(*) from public.climb_collections) <> 1 then
    raise exception 'FAIL: account can read another account';
  end if;
  update public.climb_collections set version = 2
    where user_id = 'b32fca61-188a-44e0-8e33-52c6cb251d02';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-account update allowed'; end if;
  update public.climb_collections set version = 2
    where user_id = 'b32fca61-188a-44e0-8e33-52c6cb251d01' and version = 1;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: owner cannot save'; end if;
  update public.climb_collections set version = 3
    where user_id = 'b32fca61-188a-44e0-8e33-52c6cb251d01' and version = 1;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: stale revision can overwrite'; end if;
  begin
    insert into public.climb_collections (user_id, payload)
      values ('b32fca61-188a-44e0-8e33-52c6cb251d03', '{"gyms":[],"routes":[]}');
    raise exception 'FAIL: cross-account insert allowed';
  exception when insufficient_privilege then null;
  end;

reset role;

  if not (select relrowsecurity from pg_class where oid = 'public.climb_collections'::regclass)
    then raise exception 'FAIL: RLS disabled'; end if;
  if (select public from storage.buckets where id = 'climb-photos') is distinct from false
    then raise exception 'FAIL: photos bucket not private'; end if;
  if has_table_privilege('anon', 'public.climb_collections', 'SELECT')
    then raise exception 'FAIL: anonymous table read granted'; end if;


raise exception sqlstate 'ZM001' using message = 'rollback test fixtures';
exception when sqlstate 'ZM001' then null; end; end $verify$;
