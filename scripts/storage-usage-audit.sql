-- Read-only. Run in the Supabase SQL editor as an administrator.
-- Object contents, filenames and user emails are not returned.
begin transaction read only;
select id, public, file_size_limit, allowed_mime_types from storage.buckets
where id in ('organization-sponsors','team-public-media');

select bucket_id, split_part(name,'/',1) as organization_id,
  count(*) as objects,
  sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else 0 end) as recorded_bytes,
  count(*) filter (where metadata->>'size' is null or metadata->>'size' !~ '^[0-9]+$') as objects_with_unknown_size,
  count(*) filter (where case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric >= 300000 else false end) as objects_at_or_above_new_upload_limit
from storage.objects
where bucket_id in ('organization-sponsors','team-public-media')
group by bucket_id,split_part(name,'/',1)
order by recorded_bytes desc;
commit;
