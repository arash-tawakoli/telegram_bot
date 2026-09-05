do $$
declare existing text;
begin
  select decrypted_secret into existing from vault.decrypted_secrets where name='telegram_bot_token' limit 1;
  if existing is null then raise exception 'telegram_bot_token missing'; end if;
  if not exists (select 1 from vault.decrypted_secrets where name='telegram_bot_token_runtime') then
    perform vault.create_secret(existing,'telegram_bot_token_runtime','Runtime token for Telegram UI and notification dispatcher');
  end if;
end $$;

alter table public.delivery_events add column if not exists dispatch_attempts integer not null default 0;
alter table public.delivery_events add column if not exists last_attempt_at timestamptz;
alter table public.delivery_events add column if not exists next_retry_at timestamptz;
alter table public.delivery_events add column if not exists delivery_format text not null default 'photo_card';
create index if not exists delivery_events_dispatch_idx on public.delivery_events(status,next_retry_at,created_at) where status in ('pending','failed');
