-- Keep this bucket private and preserve its owner-isolation policies.
update storage.buckets
set file_size_limit = 1073741824,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm']
where id = 'climb-photos' and public = false;
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'climb-photos';
