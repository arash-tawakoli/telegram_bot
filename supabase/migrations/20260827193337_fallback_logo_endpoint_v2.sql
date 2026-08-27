create or replace function app_private.normalize_fallback_logo_url()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.image_status='fallback' then
    new.resolved_image_url := 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/telegram-fallback-logo';
    new.image_source := 'fallback:telegram-logo';
  end if;
  return new;
end;
$$;

drop trigger if exists listings_normalize_fallback_logo on public.listings;
create trigger listings_normalize_fallback_logo
before insert or update of image_status,resolved_image_url,image_source on public.listings
for each row execute function app_private.normalize_fallback_logo_url();

update public.listings
set resolved_image_url='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/telegram-fallback-logo',
    image_source='fallback:telegram-logo'
where image_status='fallback';
