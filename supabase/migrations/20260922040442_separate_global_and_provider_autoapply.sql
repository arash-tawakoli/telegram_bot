create or replace function app_private.sync_legacy_auto_apply_preferences()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  insert into public.application_preferences(
    user_id,enabled,immoscout_enabled,kleinanzeigen_enabled,immomio_enabled
  )
  values(new.id,new.auto_apply_enabled,false,false,false)
  on conflict (user_id) do update
  set enabled=excluded.enabled;
  return new;
end
$function$;
