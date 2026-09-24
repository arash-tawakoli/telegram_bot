alter table public.platform_connections drop constraint if exists platform_connections_provider_check;
alter table public.platform_connections
  add constraint platform_connections_provider_check
  check (provider = any (array['immoscout'::text,'kleinanzeigen'::text,'immomio'::text,'immowelt'::text]));

alter table public.platform_auth_flows drop constraint if exists platform_auth_flows_provider_check;
alter table public.platform_auth_flows
  add constraint platform_auth_flows_provider_check
  check (provider = any (array['immoscout'::text,'kleinanzeigen'::text,'immomio'::text,'immowelt'::text]));

alter table public.application_preferences
  add column if not exists immowelt_enabled boolean not null default false;

create or replace function app_private.validate_application_preferences()
returns trigger language plpgsql set search_path to ''
as $function$
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then raise exception 'invalid_timezone'; end if;
  new.updated_at:=now();
  if tg_op='UPDATE' and row(new.enabled,new.daily_limit,new.timezone,new.allowed_weekdays,new.send_window_start,new.send_window_end,new.immoscout_enabled,new.kleinanzeigen_enabled,new.immomio_enabled,new.immowelt_enabled)
     is distinct from
     row(old.enabled,old.daily_limit,old.timezone,old.allowed_weekdays,old.send_window_start,old.send_window_end,old.immoscout_enabled,old.kleinanzeigen_enabled,old.immomio_enabled,old.immowelt_enabled)
  then new.config_version:=old.config_version+1; end if;
  return new;
end
$function$;

create or replace function app_private.application_provider_target(p_source_id smallint,p_raw jsonb,p_canonical_url text)
returns text language plpgsql immutable set search_path to ''
as $function$
declare t jsonb;
begin
 t:=app_private.immomio_application_target(p_raw,p_canonical_url);
 if t->>'status'='conflict' then return null; end if;
 if t->>'status'='resolved' then return 'immomio'; end if;
 return case when p_source_id=1 then 'immoscout' when p_source_id=2 then 'kleinanzeigen' when p_source_id=3 then 'immowelt' else null end;
end
$function$;

create or replace function app_private.application_provider_preference_enabled(p_user uuid,p_provider text)
returns boolean language sql stable set search_path to ''
as $function$
 select coalesce((select p.enabled and case p_provider
   when 'immoscout' then coalesce(p.immoscout_enabled,false)
   when 'kleinanzeigen' then coalesce(p.kleinanzeigen_enabled,false)
   when 'immomio' then coalesce(p.immomio_enabled,false)
   when 'immowelt' then coalesce(p.immowelt_enabled,false)
   else false end
 from public.application_preferences p where p.user_id=p_user),false)
$function$;

create or replace function public.set_application_provider_enabled_shared(p_user uuid,p_provider text,p_enabled boolean)
returns boolean language plpgsql set search_path to ''
as $function$
declare v_global boolean;
begin
 if p_provider not in ('immoscout','kleinanzeigen','immomio','immowelt') then raise exception 'invalid_provider'; end if;
 select u.auto_apply_enabled into v_global from public.bot_users u where u.id=p_user and u.is_active;
 if not found then raise exception 'participant_unavailable'; end if;
 if p_enabled and not app_private.user_is_premium(p_user) then raise exception 'premium_required'; end if;
 insert into public.application_preferences(user_id,enabled,immoscout_enabled,kleinanzeigen_enabled,immomio_enabled,immowelt_enabled)
 values(p_user,coalesce(v_global,false),
   case when p_provider='immoscout' then p_enabled else coalesce(v_global,false) end,
   case when p_provider='kleinanzeigen' then p_enabled else coalesce(v_global,false) end,
   case when p_provider='immomio' then p_enabled else coalesce(v_global,false) end,
   case when p_provider='immowelt' then p_enabled else false end)
 on conflict(user_id) do update set
   immoscout_enabled=case when p_provider='immoscout' then p_enabled else public.application_preferences.immoscout_enabled end,
   kleinanzeigen_enabled=case when p_provider='kleinanzeigen' then p_enabled else public.application_preferences.kleinanzeigen_enabled end,
   immomio_enabled=case when p_provider='immomio' then p_enabled else public.application_preferences.immomio_enabled end,
   immowelt_enabled=case when p_provider='immowelt' then p_enabled else public.application_preferences.immowelt_enabled end,
   updated_at=now();
 if not p_enabled then
  update public.applications a set status='failed',last_error='provider_paused',wait_reason=null,lease_until=null
  from public.listings l
  where a.user_id=p_user and a.listing_id=l.id and a.status='pending' and a.submission_started_at is null
    and app_private.application_provider_target(l.source_id,l.raw,l.canonical_url)=p_provider;
 end if;
 return true;
end
$function$;

create or replace function app_private.user_has_application_provider(p_user uuid)
returns boolean language sql stable set search_path to ''
as $function$
 select exists(
   select 1 from public.platform_connections c
   where c.user_id=p_user and c.status='connected' and (
     c.provider='immomio'
     or (c.provider='kleinanzeigen' and exists(select 1 from app_private.application_platforms p where p.source_id=2 and p.verified_at is not null))
     or (c.provider='immoscout' and exists(select 1 from app_private.application_platforms p where p.source_id=1 and p.verified_at is not null))
     or (c.provider='immowelt' and exists(select 1 from app_private.application_platforms p where p.source_id=3 and p.verified_at is not null))
   )
 )
$function$;

insert into app_private.application_platforms(source_id,verified_at) values(3,null) on conflict(source_id) do nothing;
