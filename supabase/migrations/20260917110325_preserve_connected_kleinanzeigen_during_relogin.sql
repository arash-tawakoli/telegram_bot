create or replace function app_private.preserve_connected_kleinanzeigen_during_relogin()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if old.provider = 'kleinanzeigen'
     and old.status = 'connected'
     and new.status = 'pending'
     and old.credential_ciphertext is not null
     and old.credential_iv is not null then
    new.status := 'connected';
    new.last_error := old.last_error;
    new.last_verified_at := old.last_verified_at;
  end if;
  return new;
end;
$$;

revoke all on function app_private.preserve_connected_kleinanzeigen_during_relogin() from public, anon, authenticated;

drop trigger if exists platform_connections_preserve_kleinanzeigen_connected on public.platform_connections;
create trigger platform_connections_preserve_kleinanzeigen_connected
before update of status on public.platform_connections
for each row
execute function app_private.preserve_connected_kleinanzeigen_during_relogin();
