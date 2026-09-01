create or replace function app_private.normalize_listing_image_url()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.source_id=2 and new.image_url is not null and new.image_url ~ '^https://img[.]kleinanzeigen[.]de/' then
    new.image_url:=regexp_replace(new.image_url,'[.]AUTO([&#?]|$)','.JPG\1','i');
  elsif new.source_id=3 and new.image_url is not null and new.image_url ~ '^https://mms[.]immowelt[.]de/' then
    if new.image_url ~ '([?&])h=50([&#]|$)' and new.image_url !~ '([?&])w=' then
      new.image_url:=regexp_replace(new.image_url,'([?&])h=50([&#]|$)','\1w=525&h=394\2','i');
    end if;
    new.resolved_image_url:=new.image_url;
    new.image_status:='direct';
    new.image_source:='immowelt_mms';
    new.image_error:=null;
    new.image_last_checked_at:=now();
  elsif new.source_id=15 and new.image_url is not null then
    if new.image_url ~ '^https://[^/]+[.]supabase[.]co/srv/obs/' then
      new.image_url:=regexp_replace(new.image_url,'^https://[^/]+[.]supabase[.]co/srv/obs/','https://www.immobilien.de/srv/obs/');
    end if;
    if new.image_url ~ '^https://www[.]immobilien[.]de/srv/obs/' then
      new.resolved_image_url:=new.image_url;
      new.image_status:='direct';
      new.image_source:='immobilien_de_cdn';
      new.image_error:=null;
      new.image_last_checked_at:=now();
    end if;
  end if;
  return new;
end;
$function$;

update public.listings
set image_url=image_url
where (source_id=3 and image_url ~ '^https://mms[.]immowelt[.]de/')
   or (source_id=15 and (
        image_url ~ '^https://[^/]+[.]supabase[.]co/srv/obs/'
        or image_url ~ '^https://www[.]immobilien[.]de/srv/obs/'
      ));
