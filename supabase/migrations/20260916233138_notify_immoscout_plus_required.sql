create or replace function app_private.notify_immoscout_plus_required()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_chat_id bigint;
  v_title text;
begin
  if new.source_id <> 1 or new.last_error <> 'plus_required' or old.last_error is not distinct from new.last_error then
    return new;
  end if;

  select u.chat_id, l.title
    into v_chat_id, v_title
  from public.bot_users u
  join public.listings l on l.id = new.listing_id
  where u.id = new.user_id;

  if v_chat_id is not null then
    perform app_private.telegram_api_call(
      'sendMessage',
      jsonb_build_object(
        'chat_id', v_chat_id,
        'text', concat(
          '⚠️ Automatische Bewerbung nicht zugestellt', E'\n\n',
          'Für dieses ImmoScout-Angebot ist ImmoScout Plus erforderlich. Ohne Plus konnte die Bewerbung nicht automatisch versendet werden.',
          case when coalesce(trim(v_title),'') <> '' then E'\n\n' || left(trim(v_title),120) else '' end
        )
      )
    );
  end if;

  return new;
end
$$;

revoke all on function app_private.notify_immoscout_plus_required() from public, anon, authenticated;

drop trigger if exists applications_notify_immoscout_plus_required on public.applications;
create trigger applications_notify_immoscout_plus_required
after update of last_error on public.applications
for each row
when (new.source_id = 1 and new.last_error = 'plus_required')
execute function app_private.notify_immoscout_plus_required();
