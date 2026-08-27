create or replace function app_private.trust_kleinanzeigen_jpeg_image()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.source_id=2
     and new.image_url ~ '^https://img\.kleinanzeigen\.de/api/v1/prod-ads/images/'
     and new.image_url ~ '\.JPG([&#?]|$)'
     and (new.resolved_image_url is null or new.image_status='fallback') then
    new.resolved_image_url:=new.image_url;
    new.image_status:='direct';
    new.image_source:='kleinanzeigen_jpeg_cdn';
    new.image_error:=null;
    new.image_last_checked_at:=now();
  end if;
  return new;
end;
$$;

drop trigger if exists listings_trust_kleinanzeigen_jpeg_image on public.listings;
create trigger listings_trust_kleinanzeigen_jpeg_image
before insert or update of source_id,image_url,resolved_image_url,image_status
on public.listings for each row execute function app_private.trust_kleinanzeigen_jpeg_image();

update public.listings
set image_status=image_status
where source_id=2 and quality_status='accepted' and image_url ~ '^https://img\.kleinanzeigen\.de/api/v1/prod-ads/images/' and image_url ~ '\.JPG([&#?]|$)';
