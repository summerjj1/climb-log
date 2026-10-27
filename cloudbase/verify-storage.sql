do $verify$
declare affected integer;
begin
  if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then
    raise exception 'FAIL: storage RLS disabled';
  end if;
  if not exists (select 1 from storage.buckets where id='climb-photos' and public=false and file_size_limit=1073741824 and allowed_mime_types @> array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm']) then
    raise exception 'FAIL: private media bucket configuration';
  end if;
  begin
    insert into storage.objects (bucket_id,name,owner_id) values
      ('climb-photos','mei-rls-fixture-a/verification.png','mei-rls-fixture-a'),
      ('climb-photos','mei-rls-fixture-b/verification.png','mei-rls-fixture-b');
    set local role authenticated;
    perform set_config('request.jwt.claim.sub','mei-rls-fixture-a',true);
    if (select count(*) from storage.objects where name in ('mei-rls-fixture-a/verification.png','mei-rls-fixture-b/verification.png')) <> 1 then
      raise exception 'FAIL: file read isolation';
    end if;
    insert into storage.objects (bucket_id,name,owner_id) values ('climb-photos','mei-rls-fixture-a/upload.png','mei-rls-fixture-a');
    begin
      insert into storage.objects (bucket_id,name,owner_id) values ('climb-photos','mei-rls-fixture-b/forbidden.png','mei-rls-fixture-a');
      raise exception 'FAIL: cross-account file insert allowed';
    exception when insufficient_privilege then null; end;
    update storage.objects set user_metadata='{"tampered":true}' where name='mei-rls-fixture-b/verification.png';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'FAIL: cross-account file update allowed'; end if;
    reset role;
    set local role anon;
    perform set_config('request.jwt.claim.sub','',true);
    if (select count(*) from storage.objects where name in ('mei-rls-fixture-a/verification.png','mei-rls-fixture-b/verification.png')) <> 0 then
      raise exception 'FAIL: anonymous private file read';
    end if;
    reset role;
    raise exception sqlstate 'ZM001' using message='rollback all metadata fixtures';
  exception when sqlstate 'ZM001' then null; end;
end $verify$;
