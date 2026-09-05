create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.bot_users(id) on delete cascade,
  provider text not null default 'stripe' check (provider = 'stripe'),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'inactive' check (status in ('inactive','active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_event_created bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_subscriptions enable row level security;
revoke all on table public.user_subscriptions from anon, authenticated;
create index if not exists user_subscriptions_status_idx on public.user_subscriptions(status, current_period_end);

alter table public.search_profiles add column if not exists profile_slot smallint not null default 1;
drop index if exists public.search_profiles_one_per_user_idx;
create unique index if not exists search_profiles_user_slot_uidx on public.search_profiles(user_id, profile_slot);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='search_profiles_profile_slot_check' and conrelid='public.search_profiles'::regclass) then
    alter table public.search_profiles add constraint search_profiles_profile_slot_check check (profile_slot between 1 and 3);
  end if;
end $$;

create or replace function app_private.user_is_premium(p_user uuid)
returns boolean
language sql
stable
set search_path=''
as $$
  select exists (
    select 1
    from public.user_subscriptions s
    where s.user_id = p_user
      and s.status in ('active','trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;
revoke all on function app_private.user_is_premium(uuid) from public;

create or replace function app_private.enforce_search_profile_limit()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.profile_slot < 1 or new.profile_slot > 3 then
    raise exception 'invalid_profile_slot' using errcode='23514';
  end if;
  if new.profile_slot > 1 and not app_private.user_is_premium(new.user_id) then
    raise exception 'premium_required_for_profile_slot' using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists search_profiles_enforce_plan_limit on public.search_profiles;
create trigger search_profiles_enforce_plan_limit
before insert or update of user_id, profile_slot on public.search_profiles
for each row execute function app_private.enforce_search_profile_limit();

create or replace function app_private.queue_listing_delivery_v3()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_group uuid;
  v_primary boolean;
  v_source_ready boolean;
  v_source_type text;
  v_haystack text := lower(concat_ws(' ',new.property_type,new.title,new.district,new.address,new.raw::text));
begin
  if tg_op='UPDATE' and new.source_id=3 and not coalesce(old.fresh_delivery_eligible,false) and coalesce(new.fresh_delivery_eligible,false) then return new; end if;
  if new.quality_status='rejected' or not coalesce(new.enrichment_delivery_eligible,true) then return new; end if;
  if not coalesce(new.fresh_delivery_eligible,false) then return new; end if;

  if v_haystack ~ '(^|[[:space:]])(ich|wir)[[:space:]]+suche(n)?[[:space:]].{0,40}(wohnung|apartment|wg-zimmer|zimmer|haus)'
     or v_haystack ~ '[[:space:]]sucht[[:space:]]+(dringend[[:space:]]+)?(eine[nr]?[[:space:]]+)?(wohnung|apartment|wg-zimmer|zimmer|haus)'
     or v_haystack ~ '^[[:space:]]*(wohnung|apartment|wg-zimmer|zimmer|haus)[[:space:]]+gesucht' then
    return new;
  end if;

  select (s.enabled and s.runtime_mode='live' and s.delivery_mode='live'), s.source_type
    into v_source_ready, v_source_type
  from public.sources s where s.id=new.source_id;
  if not coalesce(v_source_ready,false) then
    perform app_private.assign_listing_dedupe(new.id);
    return new;
  end if;

  v_group:=app_private.assign_listing_dedupe(new.id);
  select is_primary_listing into v_primary from public.listings where id=new.id;
  if not coalesce(v_primary,false) or v_group is null then return new; end if;

  insert into public.delivery_events(profile_id,listing_id,dedupe_key,status,delivery_format,recipient_user_id,next_retry_at)
  select p.id,new.id,'group:'||v_group::text,'pending','photo_card',u.id,
         case when app_private.user_is_premium(u.id) then null else new.first_seen_at + interval '2 hours' end
  from public.search_profiles p
  join public.bot_users u on u.id=p.user_id
  where p.is_active=true and u.is_active=true
    and (v_source_type <> 'Baugenossenschaft' or app_private.user_is_premium(u.id))
    and (
      coalesce(cardinality(p.property_types),0)=0
      or (
        v_haystack ~ '(tauschwohnung|tauschangebot|wohnungstausch|wohnung[[:space:]-]*tausch|tausche)'
        and 'Tauschwohnung'=any(p.property_types)
      )
      or (
        v_haystack !~ '(tauschwohnung|tauschangebot|wohnungstausch|wohnung[[:space:]-]*tausch|tausche)'
        and coalesce(new.property_type,'Wohnung')=any(p.property_types)
      )
    )
    and (
      p.max_warm_rent is null
      or (
        coalesce(nullif(new.warm_rent,0),nullif(new.cold_rent,0)) is not null
        and coalesce(nullif(new.warm_rent,0),nullif(new.cold_rent,0))<=p.max_warm_rent
      )
    )
    and (coalesce(p.min_rooms,0)<=0 or new.rooms is null or new.rooms>=p.min_rooms)
    and (coalesce(p.min_area_sqm,0)<=0 or new.area_sqm is null or new.area_sqm>=p.min_area_sqm)
    and (
      p.location_mode='all_hamburg'
      or (p.location_mode='boroughs' and coalesce(cardinality(p.boroughs),0)>=7)
      or (
        p.location_mode='neighborhoods'
        and exists(
          select 1 from unnest(p.neighborhoods) n
          where lower(concat_ws(' ',new.district,new.address,new.title,new.raw::text)) like '%'||lower(n)||'%'
        )
      )
      or (
        p.location_mode='boroughs'
        and exists(
          select 1
          from public.hamburg_neighborhoods hn
          join public.hamburg_boroughs hb on hb.id=hn.borough_id
          where hb.name=any(p.boroughs)
            and lower(concat_ws(' ',new.district,new.address,new.title,new.raw::text)) like '%'||lower(hn.name)||'%'
        )
      )
      or (
        coalesce(cardinality(p.districts),0)>0
        and (
          'Ganz Hamburg'=any(p.districts)
          or exists(
            select 1 from unnest(p.districts) d
            where lower(concat_ws(' ',new.district,new.address,new.title,new.raw::text)) like '%'||lower(d)||'%'
          )
        )
      )
    )
  on conflict do nothing;
  return new;
end;
$$;
