create or replace function app_private.application_provider_for_listing(p_source_id smallint, p_raw jsonb)
returns text
language sql
stable
set search_path to ''
as $$
  select case
    when p_source_id = 1 then 'immoscout'
    when p_source_id = 2 then 'kleinanzeigen'
    when coalesce(
      p_raw->>'applicationLink',
      p_raw->>'application_link',
      p_raw->>'applicationUrl',
      p_raw->>'application_url',
      ''
    ) ~* '^https://tenant\.immomio\.com/apply/[0-9a-f-]{36}/?([?#].*)?$' then 'immomio'
    else null
  end
$$;

create or replace function app_private.application_provider_ready(p_user uuid, p_source_id smallint, p_raw jsonb)
returns boolean
language plpgsql
stable
set search_path to ''
as $$
declare
  v_provider text;
begin
  v_provider := app_private.application_provider_for_listing(p_source_id, p_raw);
  if v_provider is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.platform_connections c
    where c.user_id = p_user
      and c.provider = v_provider
      and c.status = 'connected'
  ) then
    return false;
  end if;

  if v_provider = 'immomio' then
    return true;
  elsif v_provider = 'kleinanzeigen' then
    return exists (
      select 1 from app_private.application_platforms p
      where p.source_id = 2 and p.verified_at is not null
    );
  elsif v_provider = 'immoscout' then
    return exists (
      select 1 from app_private.application_platforms p
      where p.source_id = 1 and p.verified_at is not null
    );
  end if;

  return false;
end
$$;

create or replace function app_private.user_has_application_provider(p_user uuid)
returns boolean
language sql
stable
set search_path to ''
as $$
  select exists (
    select 1
    from public.platform_connections c
    where c.user_id = p_user
      and c.status = 'connected'
      and (
        c.provider = 'immomio'
        or (
          c.provider = 'kleinanzeigen'
          and exists (
            select 1 from app_private.application_platforms p
            where p.source_id = 2 and p.verified_at is not null
          )
        )
        or (
          c.provider = 'immoscout'
          and exists (
            select 1 from app_private.application_platforms p
            where p.source_id = 1 and p.verified_at is not null
          )
        )
      )
  )
$$;

create or replace function app_private.guard_application_opt_in()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.auto_apply_enabled and (tg_op = 'INSERT' or not old.auto_apply_enabled) then
    if not new.is_active
       or not app_private.user_is_premium(new.id)
       or not app_private.applicant_profile_complete(new.id)
       or not app_private.user_has_application_provider(new.id)
    then
      raise exception 'automatic applications are not available';
    end if;
  end if;
  return new;
end
$$;

create or replace function app_private.enqueue_matched_application()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  insert into public.applications(user_id, listing_id, source_id)
  select u.id, l.id, l.source_id
  from public.bot_users u
  join public.listings l on l.id = new.listing_id
  where u.id = new.recipient_user_id
    and u.is_active
    and u.auto_apply_enabled
    and app_private.user_is_premium(u.id)
    and app_private.applicant_profile_complete(u.id)
    and app_private.application_provider_ready(u.id, l.source_id, l.raw)
    and l.is_active
    and app_private.current_listing_is_delivery_fresh(l.source_id, l.raw, l.fresh_delivery_eligible)
  on conflict(user_id, listing_id) do nothing;
  return new;
end
$$;

create or replace function public.begin_application_submission(p_id uuid)
returns boolean
language plpgsql
set search_path to ''
as $$
declare
  a public.applications%rowtype;
begin
  select * into a from public.applications where id = p_id for update;
  if not found or a.status <> 'pending' or a.submission_started_at is not null then
    return false;
  end if;

  if not exists (
    select 1
    from public.bot_users u
    join public.listings l on l.id = a.listing_id
    where u.id = a.user_id
      and u.is_active
      and u.auto_apply_enabled
      and app_private.user_is_premium(u.id)
      and app_private.applicant_profile_complete(u.id)
      and app_private.application_provider_ready(u.id, l.source_id, l.raw)
      and l.is_active
      and l.source_id = a.source_id
      and app_private.current_listing_is_delivery_fresh(l.source_id, l.raw, l.fresh_delivery_eligible)
      and exists (
        select 1 from public.delivery_events d
        where d.listing_id = l.id and d.recipient_user_id = u.id
      )
  ) then
    update public.applications
    set status = 'failed', last_error = 'not_eligible'
    where id = p_id;
    return false;
  end if;

  update public.applications
  set status = 'processing', attempts = attempts + 1, submission_started_at = now()
  where id = p_id;
  return true;
end
$$;

create or replace function public.enqueue_application_now(p_user uuid, p_listing uuid)
returns uuid
language plpgsql
set search_path to ''
as $$
declare
  result_id uuid;
begin
  if p_user is null or p_listing is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.bot_users u
    join public.listings l on l.id = p_listing
    where u.id = p_user
      and u.is_active
      and app_private.user_is_premium(u.id)
      and app_private.applicant_profile_complete(u.id)
      and app_private.application_provider_ready(u.id, l.source_id, l.raw)
      and l.is_active
      and app_private.current_listing_is_delivery_fresh(l.source_id, l.raw, l.fresh_delivery_eligible)
      and exists (
        select 1 from public.delivery_events d
        where d.listing_id = l.id and d.recipient_user_id = u.id
      )
  ) then
    return null;
  end if;

  insert into public.applications(user_id, listing_id, source_id)
  select p_user, l.id, l.source_id
  from public.listings l
  where l.id = p_listing
  on conflict(user_id, listing_id) do nothing
  returning id into result_id;

  if result_id is null then
    select id into result_id
    from public.applications
    where user_id = p_user and listing_id = p_listing;
  end if;

  return result_id;
end
$$;
