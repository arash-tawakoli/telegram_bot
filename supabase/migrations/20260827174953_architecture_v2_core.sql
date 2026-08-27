create extension if not exists pgmq;

alter table public.source_connectors add column if not exists evidence_tier text not null default 'K2';
alter table public.source_connectors add column if not exists connector_role text not null default 'primary';
alter table public.source_connectors add column if not exists enumerable boolean not null default false;
alter table public.source_connectors add column if not exists shadow_only boolean not null default false;

update public.source_connectors
set connector_role = case when priority = 1 then 'primary' else 'fallback' end,
    evidence_tier = case
      when not enabled or connector_kind = 'unsupported' then 'K3'
      when connector_kind in ('immomio_tenant','json_endpoint','json_ld','next_data','wp_rest','immosolve_api') then 'K1'
      when connector_kind in ('indexed_html','indexed_rss') then 'K3'
      when lower(label) like '%monitoring%' or lower(label) like '%bewerbungsportal%' or lower(label) like '%interessent%' then 'K3'
      else 'K2'
    end,
    enumerable = case
      when connector_kind in ('immomio_tenant','json_endpoint','wp_rest','immosolve_api','json_ld','next_data') and priority = 1 then true
      else false
    end;
update public.source_connectors set shadow_only = (evidence_tier = 'K3');

alter table public.sources add column if not exists delivery_mode text not null default 'live';
update public.sources s
set delivery_mode = case
  when not s.enabled then 'shadow'
  when exists (select 1 from public.source_connectors sc where sc.source_id=s.id and sc.enabled and sc.evidence_tier in ('K1','K2')) then 'live'
  else 'shadow'
end;

create table if not exists public.canonical_listings (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  preferred_occurrence_id uuid null,
  title text null,
  address text null,
  district text null,
  postal_code text null,
  city text not null default 'Hamburg',
  warm_rent numeric null,
  cold_rent numeric null,
  rooms numeric null,
  area_sqm numeric null,
  available_from date null,
  property_type text null,
  furnished boolean null,
  wbs_required boolean null,
  image_url text null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.listing_occurrences (
  id uuid primary key default gen_random_uuid(),
  canonical_listing_id uuid not null references public.canonical_listings(id) on delete cascade,
  legacy_listing_id uuid not null unique references public.listings(id) on delete cascade,
  source_id smallint not null references public.sources(id),
  connector_id bigint null references public.source_connectors(id),
  source_listing_key text not null,
  external_id text null,
  source_url text not null,
  image_url text null,
  evidence_tier text not null default 'K2',
  quality_rank integer not null default 50,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  miss_count integer not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id, source_listing_key)
);

alter table public.canonical_listings
  drop constraint if exists canonical_listings_preferred_occurrence_id_fkey;
alter table public.canonical_listings
  add constraint canonical_listings_preferred_occurrence_id_fkey
  foreign key (preferred_occurrence_id) references public.listing_occurrences(id) on delete set null;

create index if not exists listing_occurrences_canonical_idx on public.listing_occurrences(canonical_listing_id, is_active, quality_rank, last_seen_at desc);
create index if not exists listing_occurrences_source_active_idx on public.listing_occurrences(source_id, is_active, last_seen_at desc);
create index if not exists canonical_listings_active_seen_idx on public.canonical_listings(is_active, last_seen_at desc);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.search_profiles(id) on delete cascade,
  recipient_user_id uuid not null references public.bot_users(id) on delete cascade,
  canonical_listing_id uuid not null references public.canonical_listings(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  dedupe_key text not null,
  status text not null default 'matched',
  match_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id, canonical_listing_id)
);
create index if not exists matches_recipient_created_idx on public.matches(recipient_user_id, created_at desc);
create index if not exists matches_listing_idx on public.matches(canonical_listing_id, created_at desc);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  recipient_user_id uuid not null references public.bot_users(id) on delete cascade,
  profile_id uuid not null references public.search_profiles(id) on delete cascade,
  canonical_listing_id uuid not null references public.canonical_listings(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  dedupe_key text not null,
  status text not null default 'pending',
  delivery_event_id uuid null references public.delivery_events(id) on delete set null,
  telegram_message_id bigint null,
  attempts integer not null default 0,
  error_message text null,
  next_retry_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz null,
  unique(recipient_user_id, dedupe_key)
);
create unique index if not exists notification_outbox_delivery_event_uidx on public.notification_outbox(delivery_event_id) where delivery_event_id is not null;
create index if not exists notification_outbox_status_idx on public.notification_outbox(status, next_retry_at, created_at);

create table if not exists public.source_jobs (
  id uuid primary key default gen_random_uuid(),
  queue_msg_id bigint unique,
  source_id smallint not null references public.sources(id),
  status text not null default 'enqueued',
  attempts integer not null default 0,
  worker text null,
  error_message text null,
  enqueued_at timestamptz not null default now(),
  started_at timestamptz null,
  finished_at timestamptz null,
  updated_at timestamptz not null default now()
);
create index if not exists source_jobs_status_idx on public.source_jobs(status, enqueued_at);
create index if not exists source_jobs_source_idx on public.source_jobs(source_id, enqueued_at desc);

create table if not exists public.image_cache (
  image_url text primary key,
  status text not null default 'unknown',
  content_type text null,
  content_length bigint null,
  checked_at timestamptz null,
  telegram_file_id text null,
  last_error text null,
  updated_at timestamptz not null default now()
);

alter table public.canonical_listings enable row level security;
alter table public.listing_occurrences enable row level security;
alter table public.matches enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.source_jobs enable row level security;
alter table public.image_cache enable row level security;

create or replace function app_private.upsert_listing_architecture(p_listing_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  l public.listings%rowtype;
  sc record;
  v_dedupe text;
  v_canonical uuid;
  v_occurrence uuid;
  v_rank integer;
begin
  select * into l from public.listings where id = p_listing_id;
  if not found then return null; end if;

  select id, connector_kind, evidence_tier into sc
  from public.source_connectors
  where source_id = l.source_id and enabled = true
  order by priority
  limit 1;

  v_dedupe := case
    when l.cross_source_hash is not null and l.cross_source_hash <> '' then 'x:' || l.cross_source_hash
    else 'u:' || encode(extensions.digest(lower(l.canonical_url), 'sha256'), 'hex')
  end;

  v_rank := case
    when sc.connector_kind = 'immomio_tenant' then 10
    when l.source_id in (1,2,3) then 20
    when coalesce(sc.evidence_tier,'K2') = 'K1' then 30
    when coalesce(sc.evidence_tier,'K2') = 'K2' then 50
    else 90
  end;

  insert into public.canonical_listings(
    dedupe_key,title,address,district,postal_code,city,warm_rent,cold_rent,rooms,area_sqm,
    available_from,property_type,furnished,wbs_required,image_url,first_seen_at,last_seen_at,is_active,updated_at
  ) values (
    v_dedupe,l.title,l.address,l.district,l.postal_code,l.city,l.warm_rent,l.cold_rent,l.rooms,l.area_sqm,
    l.available_from,l.property_type,l.furnished,l.wbs_required,l.image_url,l.first_seen_at,l.last_seen_at,l.is_active,now()
  )
  on conflict (dedupe_key) do update set
    first_seen_at = least(public.canonical_listings.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(public.canonical_listings.last_seen_at, excluded.last_seen_at),
    is_active = public.canonical_listings.is_active or excluded.is_active,
    updated_at = now()
  returning id into v_canonical;

  insert into public.listing_occurrences(
    canonical_listing_id,legacy_listing_id,source_id,connector_id,source_listing_key,external_id,source_url,image_url,
    evidence_tier,quality_rank,first_seen_at,last_seen_at,miss_count,is_active,metadata,updated_at
  ) values (
    v_canonical,l.id,l.source_id,sc.id,l.source_listing_key,l.external_id,l.canonical_url,l.image_url,
    coalesce(sc.evidence_tier,'K2'),v_rank,l.first_seen_at,l.last_seen_at,0,l.is_active,
    jsonb_build_object('provider',coalesce(l.raw->>'provider',sc.connector_kind),'legacy_listing_id',l.id),now()
  )
  on conflict (source_id, source_listing_key) do update set
    canonical_listing_id=excluded.canonical_listing_id,
    legacy_listing_id=excluded.legacy_listing_id,
    connector_id=excluded.connector_id,
    external_id=excluded.external_id,
    source_url=excluded.source_url,
    image_url=excluded.image_url,
    evidence_tier=excluded.evidence_tier,
    quality_rank=excluded.quality_rank,
    last_seen_at=excluded.last_seen_at,
    miss_count=case when excluded.last_seen_at > public.listing_occurrences.last_seen_at then 0 else public.listing_occurrences.miss_count end,
    is_active=excluded.is_active,
    metadata=excluded.metadata,
    updated_at=now()
  returning id into v_occurrence;

  select o.id into v_occurrence
  from public.listing_occurrences o
  where o.canonical_listing_id=v_canonical and o.is_active=true
  order by o.quality_rank, o.last_seen_at desc, o.id
  limit 1;

  if v_occurrence is not null then
    update public.canonical_listings c
    set preferred_occurrence_id=v_occurrence,
        title=l2.title,address=l2.address,district=l2.district,postal_code=l2.postal_code,city=l2.city,
        warm_rent=l2.warm_rent,cold_rent=l2.cold_rent,rooms=l2.rooms,area_sqm=l2.area_sqm,
        available_from=l2.available_from,property_type=l2.property_type,furnished=l2.furnished,
        wbs_required=l2.wbs_required,image_url=l2.image_url,last_seen_at=l2.last_seen_at,is_active=true,updated_at=now()
    from public.listing_occurrences o2
    join public.listings l2 on l2.id=o2.legacy_listing_id
    where c.id=v_canonical and o2.id=v_occurrence;
  end if;

  return v_canonical;
end;
$$;

create or replace function app_private.sync_listing_architecture_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app_private.upsert_listing_architecture(new.id);
  return new;
end;
$$;

drop trigger if exists listings_00_sync_architecture on public.listings;
create trigger listings_00_sync_architecture
after insert or update of source_id,source_listing_key,external_id,canonical_url,title,address,district,postal_code,city,warm_rent,cold_rent,rooms,area_sqm,available_from,property_type,furnished,wbs_required,image_url,cross_source_hash,last_seen_at,is_active
on public.listings for each row execute function app_private.sync_listing_architecture_trigger();

select app_private.upsert_listing_architecture(id) from public.listings;

create or replace function app_private.queue_new_listing_delivery()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_canonical uuid;
begin
  if not exists (
    select 1 from public.sources s
    where s.id=new.source_id and s.enabled=true and s.last_success_at is not null and s.delivery_mode='live'
  ) then return new; end if;

  v_canonical := app_private.upsert_listing_architecture(new.id);

  insert into public.matches(profile_id,recipient_user_id,canonical_listing_id,listing_id,dedupe_key,status,match_snapshot)
  select p.id,p.user_id,v_canonical,new.id,
         coalesce(new.cross_source_hash,'source:'||new.source_id::text||':'||new.source_listing_key),
         'matched',
         jsonb_build_object('max_warm_rent',p.max_warm_rent,'min_rooms',p.min_rooms,'min_area_sqm',p.min_area_sqm,'location_mode',p.location_mode)
  from public.search_profiles p
  join public.bot_users u on u.id=p.user_id
  where p.is_active=true and u.is_active=true
    and (coalesce(cardinality(p.property_types),0)=0 or coalesce(new.property_type,'Wohnung')=any(p.property_types))
    and (p.max_warm_rent is null or coalesce(new.warm_rent,new.cold_rent) is null or coalesce(new.warm_rent,new.cold_rent)<=p.max_warm_rent)
    and (coalesce(p.min_rooms,0)<=0 or new.rooms is null or new.rooms>=p.min_rooms)
    and (coalesce(p.min_area_sqm,0)<=0 or new.area_sqm is null or new.area_sqm>=p.min_area_sqm)
    and (not p.wbs_only or coalesce(new.wbs_required,false))
    and (coalesce(p.furnished_preference,'any')='any' or new.furnished is null
         or (p.furnished_preference in ('yes','furnished') and new.furnished=true)
         or (p.furnished_preference in ('no','unfurnished') and new.furnished=false))
    and (
      p.location_mode='all_hamburg'
      or (p.location_mode='neighborhoods' and exists (
        select 1 from unnest(p.neighborhoods) n where lower(concat_ws(' ',new.district,new.address,new.title)) like '%'||lower(n)||'%'
      ))
      or (p.location_mode='boroughs' and exists (
        select 1 from public.hamburg_neighborhoods hn
        join public.hamburg_boroughs hb on hb.id=hn.borough_id
        where hb.name=any(p.boroughs)
          and lower(concat_ws(' ',new.district,new.address,new.title)) like '%'||lower(hn.name)||'%'
      ))
      or (coalesce(cardinality(p.districts),0)>0 and ('Ganz Hamburg'=any(p.districts) or exists (
        select 1 from unnest(p.districts) d where lower(concat_ws(' ',new.district,new.address,new.title)) like '%'||lower(d)||'%'
      )))
    )
  on conflict (profile_id, canonical_listing_id) do update set
    listing_id=excluded.listing_id,dedupe_key=excluded.dedupe_key,status='matched',match_snapshot=excluded.match_snapshot,updated_at=now();

  insert into public.notification_outbox(match_id,recipient_user_id,profile_id,canonical_listing_id,listing_id,dedupe_key,status)
  select distinct on (m.recipient_user_id)
         m.id,m.recipient_user_id,m.profile_id,m.canonical_listing_id,m.listing_id,m.dedupe_key,'pending'
  from public.matches m
  join public.search_profiles p on p.id=m.profile_id
  where m.canonical_listing_id=v_canonical and m.status='matched' and p.is_active=true
  order by m.recipient_user_id,p.updated_at desc,p.created_at desc
  on conflict (recipient_user_id,dedupe_key) do nothing;

  return new;
end;
$$;

create or replace function app_private.outbox_enqueue_delivery_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_id uuid;
begin
  if new.delivery_event_id is not null then return new; end if;
  insert into public.delivery_events(profile_id,listing_id,dedupe_key,status,delivery_format,recipient_user_id)
  values(new.profile_id,new.listing_id,new.dedupe_key,'pending','photo_card',new.recipient_user_id)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.delivery_events
    where recipient_user_id=new.recipient_user_id and dedupe_key=new.dedupe_key and status<>'skipped'
    order by created_at desc limit 1;
  end if;
  if v_id is not null then
    update public.notification_outbox set delivery_event_id=v_id,status='queued',updated_at=now() where id=new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists notification_outbox_enqueue_delivery on public.notification_outbox;
create trigger notification_outbox_enqueue_delivery
after insert on public.notification_outbox for each row execute function app_private.outbox_enqueue_delivery_event();

create or replace function app_private.sync_outbox_from_delivery_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.notification_outbox
  set status=case when new.status='processing' then 'processing' when new.status='sent' then 'sent' when new.status='failed' then 'failed' when new.status='skipped' then 'skipped' else status end,
      telegram_message_id=new.telegram_message_id,
      attempts=new.dispatch_attempts,
      error_message=new.error_message,
      next_retry_at=new.next_retry_at,
      sent_at=new.sent_at,
      updated_at=now()
  where delivery_event_id=new.id;
  return new;
end;
$$;

drop trigger if exists delivery_events_sync_outbox on public.delivery_events;
create trigger delivery_events_sync_outbox
after update of status,telegram_message_id,dispatch_attempts,error_message,next_retry_at,sent_at
on public.delivery_events for each row execute function app_private.sync_outbox_from_delivery_event();

insert into public.matches(profile_id,recipient_user_id,canonical_listing_id,listing_id,dedupe_key,status,match_snapshot,created_at,updated_at)
select distinct on (de.profile_id,lo.canonical_listing_id)
       de.profile_id,coalesce(de.recipient_user_id,p.user_id),lo.canonical_listing_id,de.listing_id,de.dedupe_key,
       case when de.status='skipped' then 'suppressed' else 'matched' end,'{}'::jsonb,de.created_at,now()
from public.delivery_events de
join public.search_profiles p on p.id=de.profile_id
join public.listing_occurrences lo on lo.legacy_listing_id=de.listing_id
where coalesce(de.recipient_user_id,p.user_id) is not null
order by de.profile_id,lo.canonical_listing_id,de.created_at desc
on conflict (profile_id,canonical_listing_id) do nothing;

insert into public.notification_outbox(match_id,recipient_user_id,profile_id,canonical_listing_id,listing_id,dedupe_key,status,delivery_event_id,telegram_message_id,attempts,error_message,next_retry_at,created_at,updated_at,sent_at)
select distinct on (coalesce(de.recipient_user_id,p.user_id),de.dedupe_key)
       m.id,coalesce(de.recipient_user_id,p.user_id),de.profile_id,m.canonical_listing_id,de.listing_id,de.dedupe_key,
       case de.status when 'sent' then 'sent' when 'failed' then 'failed' when 'skipped' then 'skipped' when 'processing' then 'processing' else 'queued' end,
       de.id,de.telegram_message_id,de.dispatch_attempts,de.error_message,de.next_retry_at,de.created_at,now(),de.sent_at
from public.delivery_events de
join public.search_profiles p on p.id=de.profile_id
join public.listing_occurrences lo on lo.legacy_listing_id=de.listing_id
join public.matches m on m.profile_id=de.profile_id and m.canonical_listing_id=lo.canonical_listing_id
where coalesce(de.recipient_user_id,p.user_id) is not null
order by coalesce(de.recipient_user_id,p.user_id),de.dedupe_key,de.created_at desc
on conflict (recipient_user_id,dedupe_key) do nothing;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
