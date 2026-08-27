create or replace function public.get_bot_secret(secret_name text)
returns text
language sql
security definer
set search_path=''
as $$
  select case
    when secret_name='telegram_bot_token' then (
      select decrypted_secret from vault.decrypted_secrets where name='telegram_bot_token_runtime' limit 1
    )
    else (
      select decrypted_secret from vault.decrypted_secrets where name=secret_name limit 1
    )
  end;
$$;
revoke execute on function public.get_bot_secret(text) from public,anon,authenticated;
grant execute on function public.get_bot_secret(text) to service_role,postgres;
