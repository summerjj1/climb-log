-- Existing projects: extend accepted content types without changing privacy or RLS.
begin;
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
where id = 'climb-photos';
commit;
