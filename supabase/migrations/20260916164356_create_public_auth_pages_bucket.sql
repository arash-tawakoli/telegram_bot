insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('auth-pages', 'auth-pages', true, 100000, array['text/html']::text[])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;