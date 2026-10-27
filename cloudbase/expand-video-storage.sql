-- Apply to the existing private CloudBase bucket. No policy or visibility changes.
update storage.buckets
set file_size_limit = 209715200
where id = 'climb-photos' and public = false and file_size_limit = 20971520;
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'climb-photos';
