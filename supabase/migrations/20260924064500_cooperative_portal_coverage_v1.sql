create or replace function app_private.canonical_provider_entity(p_value text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when p_value is null or btrim(p_value)='' then null
    when lower(p_value) ~ 'saga' then 'SAGA'
    when lower(p_value) ~ 'finkenw(ä|ae)rder.*hoffnung' then 'Finkenwärder-Hoffnung'
    when lower(p_value) ~ 'gewoba[[:space:]-]*nord' then 'GEWOBA Nord'
    when lower(p_value) ~ 'neue[[:space:]]+lübecker' then 'NEUE LÜBECKER'
    when lower(p_value) ~ 'reiherstieg' then 'Bauverein Reiherstieg'
    when lower(p_value) ~ 'vereinigte.*hamburger.*wohnungsbau|^vhw$' then 'VHW'
    when lower(p_value) ~ 'gartenstadt[[:space:]]+farmsen|^mgf' then 'mgf Gartenstadt Farmsen'
    when lower(p_value) ~ 'rahlstedter.*baugenossenschaft|^harabau$' then 'HARABAU'
    else btrim(p_value)
  end;
$$;

create or replace function app_private.provider_object_identity(p_raw jsonb,p_evidence jsonb)
returns text
language sql
immutable
set search_path to ''
as $$
  with x as (
    select
      app_private.canonical_provider_entity(coalesce(
        p_raw->>'provider_entity',
        p_evidence#>>'{preview,facts,provider_entity}',
        case when p_raw->>'saga_object_ref' is not null then 'SAGA' end
      )) as entity,
      upper(regexp_replace(regexp_replace(btrim(coalesce(
        p_raw->>'provider_object_ref',
        p_raw->>'saga_object_ref',
        p_evidence#>>'{preview,facts,provider_object_ref}',
        p_evidence#>>'{preview,facts,saga_object_ref}',
        p_evidence#>>'{saga_probe,saga_object_ref}',
        ''
      )),'[[:space:]]*/[[:space:]]*','/','g'),'[[:space:]]+',' ','g')) as ref
  )
  select case when entity is not null and length(ref)>=4 then entity||'|'||ref else null end
  from x;
$$;

create index if not exists idx_listings_provider_object_identity
on public.listings ((app_private.provider_object_identity(raw,enrichment_evidence)))
where app_private.provider_object_identity(raw,enrichment_evidence) is not null;

create or replace function app_private.assign_listing_dedupe(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c public.listings%rowtype;
  v_group uuid;
  v_old_group uuid;
  v_winner uuid;
  v_target jsonb;
  v_sid text;
  v_saga_ref text;
  v_provider_key text;
begin
  select * into c from public.listings where id=p_listing_id for update;
  if not found or c.quality_status='rejected' then return null; end if;
  v_old_group:=c.dedupe_group_id;
  v_target:=app_private.immomio_application_target(c.raw,c.canonical_url);
  v_sid:=case when v_target->>'status'='resolved' then v_target->>'source_identifier' end;
  v_saga_ref:=app_private.saga_object_ref(c.raw,c.enrichment_evidence);
  v_provider_key:=app_private.provider_object_identity(c.raw,c.enrichment_evidence);

  select l.dedupe_group_id into v_group
  from public.listings l
  where l.id<>c.id and l.is_active=true and l.quality_status<>'rejected'
    and l.dedupe_group_id is not null
    and (
      (v_provider_key is not null and app_private.provider_object_identity(l.raw,l.enrichment_evidence)=v_provider_key)
      or (v_saga_ref is not null and app_private.saga_object_ref(l.raw,l.enrichment_evidence)=v_saga_ref)
      or (v_sid is not null and app_private.immomio_application_target(l.raw,l.canonical_url)->>'source_identifier'=v_sid)
      or (c.canonical_url is not null and l.canonical_url=c.canonical_url)
      or (c.cross_source_hash is not null and l.cross_source_hash=c.cross_source_hash)
      or (length(app_private.normalized_listing_address(c.address))>=6
        and app_private.normalized_listing_address(c.address)=app_private.normalized_listing_address(l.address)
        and (c.rooms is null or l.rooms is null or abs(c.rooms-l.rooms)<=0.5)
        and (c.area_sqm is null or l.area_sqm is null or abs(c.area_sqm-l.area_sqm)<=3))
      or (
        c.source_id<>l.source_id and nullif(trim(c.postal_code),'') is not null
        and c.postal_code=l.postal_code
        and length(regexp_replace(lower(coalesce(c.title,'')),'[^[:alnum:]äöüß]+','','g'))>=12
        and regexp_replace(lower(coalesce(c.title,'')),'[^[:alnum:]äöüß]+','','g')
          =regexp_replace(lower(coalesce(l.title,'')),'[^[:alnum:]äöüß]+','','g')
        and c.rooms is not null and l.rooms is not null and abs(c.rooms-l.rooms)<=0.25
        and c.area_sqm is not null and l.area_sqm is not null and abs(c.area_sqm-l.area_sqm)<=1
        and coalesce(nullif(c.warm_rent,0),nullif(c.cold_rent,0)) is not null
        and coalesce(nullif(l.warm_rent,0),nullif(l.cold_rent,0)) is not null
        and abs(coalesce(nullif(c.warm_rent,0),nullif(c.cold_rent,0))-coalesce(nullif(l.warm_rent,0),nullif(l.cold_rent,0)))
          <=greatest(5,least(coalesce(nullif(c.warm_rent,0),nullif(c.cold_rent,0)),coalesce(nullif(l.warm_rent,0),nullif(l.cold_rent,0)))*0.01)
      )
    )
    and (
      v_provider_key is null
      or not exists(
        select 1 from public.listings g
        where g.dedupe_group_id=l.dedupe_group_id and g.id<>c.id
          and g.is_active=true and g.quality_status<>'rejected'
          and app_private.provider_object_identity(g.raw,g.enrichment_evidence) is not null
          and split_part(app_private.provider_object_identity(g.raw,g.enrichment_evidence),'|',1)=split_part(v_provider_key,'|',1)
          and app_private.provider_object_identity(g.raw,g.enrichment_evidence)<>v_provider_key
      )
    )
    and (
      v_saga_ref is null
      or not exists(
        select 1 from public.listings g
        where g.dedupe_group_id=l.dedupe_group_id and g.id<>c.id
          and g.is_active=true and g.quality_status<>'rejected'
          and app_private.saga_object_ref(g.raw,g.enrichment_evidence) is not null
          and app_private.saga_object_ref(g.raw,g.enrichment_evidence)<>v_saga_ref
      )
    )
    and (
      (v_provider_key is not null and app_private.provider_object_identity(l.raw,l.enrichment_evidence)=v_provider_key)
      or (v_saga_ref is not null and app_private.saga_object_ref(l.raw,l.enrichment_evidence)=v_saga_ref)
      or v_sid is null
      or not exists(
        select 1 from public.listings g
        cross join lateral(select app_private.immomio_application_target(g.raw,g.canonical_url) target) t
        where g.dedupe_group_id=l.dedupe_group_id and g.id<>c.id
          and g.is_active=true and g.quality_status<>'rejected'
          and t.target->>'status'='resolved' and t.target->>'source_identifier'<>v_sid
      )
    )
  order by
    (v_provider_key is not null and app_private.provider_object_identity(l.raw,l.enrichment_evidence)=v_provider_key) desc,
    (v_saga_ref is not null and app_private.saga_object_ref(l.raw,l.enrichment_evidence)=v_saga_ref) desc,
    (l.dedupe_group_id=v_old_group) desc nulls last,
    l.first_seen_at,l.id
  limit 1;

  if v_group is null and v_old_group is not null
     and exists(select 1 from public.listing_dedupe_groups where id=v_old_group)
     and (
       v_provider_key is null
       or not exists(
         select 1 from public.listings g
         where g.dedupe_group_id=v_old_group and g.id<>c.id
           and g.is_active=true and g.quality_status<>'rejected'
           and app_private.provider_object_identity(g.raw,g.enrichment_evidence) is not null
           and split_part(app_private.provider_object_identity(g.raw,g.enrichment_evidence),'|',1)=split_part(v_provider_key,'|',1)
           and app_private.provider_object_identity(g.raw,g.enrichment_evidence)<>v_provider_key
       )
     )
     and (
       v_saga_ref is null
       or not exists(
         select 1 from public.listings g
         where g.dedupe_group_id=v_old_group and g.id<>c.id
           and g.is_active=true and g.quality_status<>'rejected'
           and app_private.saga_object_ref(g.raw,g.enrichment_evidence) is not null
           and app_private.saga_object_ref(g.raw,g.enrichment_evidence)<>v_saga_ref
       )
     )
     and (
       (v_provider_key is not null and exists(
         select 1 from public.listings g
         where g.dedupe_group_id=v_old_group and g.id<>c.id
           and app_private.provider_object_identity(g.raw,g.enrichment_evidence)=v_provider_key
       ))
       or (v_saga_ref is not null and exists(
         select 1 from public.listings g
         where g.dedupe_group_id=v_old_group and g.id<>c.id
           and app_private.saga_object_ref(g.raw,g.enrichment_evidence)=v_saga_ref
       ))
       or v_sid is null
       or not exists(
         select 1 from public.listings g
         cross join lateral(select app_private.immomio_application_target(g.raw,g.canonical_url) target)t
         where g.dedupe_group_id=v_old_group and g.id<>c.id
           and g.is_active=true and g.quality_status<>'rejected'
           and t.target->>'status'='resolved' and t.target->>'source_identifier'<>v_sid
       )
     )
  then
    v_group:=v_old_group;
  end if;

  if v_group is null then
    insert into public.listing_dedupe_groups default values returning id into v_group;
  end if;

  update public.listings set dedupe_group_id=v_group
  where id=c.id and dedupe_group_id is distinct from v_group;

  if v_old_group is not null and v_old_group<>v_group then
    perform app_private.refresh_listing_dedupe_group(v_old_group);
  end if;

  v_winner:=app_private.refresh_listing_dedupe_group(v_group);
  update public.listings
  set dedupe_match_reason=case when id=v_winner then 'primary' else 'duplicate' end
  where dedupe_group_id=v_group
    and dedupe_match_reason is distinct from (case when id=v_winner then 'primary' else 'duplicate' end);

  update public.delivery_events de
  set status='skipped',next_retry_at=null,error_message='Deduplicated in favor of preferred listing'
  from public.listings dl
  where de.listing_id=dl.id and dl.dedupe_group_id=v_group and dl.id<>v_winner
    and de.status in ('pending','failed') and not coalesce(de.delivery_outcome_unknown,false);

  return v_group;
end
$function$;

create or replace function app_private.refresh_listing_dedupe_group(p_group_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare v_winner uuid;
begin
  if p_group_id is null then return null; end if;
  select l.id into v_winner
  from public.listings l
  join public.sources s on s.id=l.source_id
  where l.dedupe_group_id=p_group_id
    and l.is_active=true
    and l.quality_status<>'rejected'
  order by
    case
      when app_private.provider_object_identity(l.raw,l.enrichment_evidence) is not null
       and s.source_type='Baugenossenschaft'
       and (
         coalesce(l.canonical_url,'') ~* '^https://tenant[.]immomio[.]com/'
         or coalesce(l.raw->>'applicationLink','') ~* '^https://tenant[.]immomio[.]com/'
       )
      then 1 else 0
    end desc,
    case
      when app_private.provider_object_identity(l.raw,l.enrichment_evidence) is not null
        then coalesce(l.fresh_delivery_eligible,false)::int
      when app_private.saga_object_ref(l.raw,l.enrichment_evidence) is not null
        then coalesce(l.fresh_delivery_eligible,false)::int
      else 0
    end desc,
    s.listing_priority asc,
    ((l.resolved_image_url is not null)::int+(l.address is not null)::int
     +(l.warm_rent is not null)::int+(l.cold_rent is not null)::int
     +(l.rooms is not null)::int+(l.area_sqm is not null)::int
     +(l.deposit is not null or l.deposit_text is not null)::int) desc,
    l.first_seen_at asc,l.id
  limit 1;

  update public.listings
  set is_primary_listing=(v_winner is not null and id=v_winner),
      duplicate_of_listing_id=case when v_winner is null or id=v_winner then null else v_winner end
  where dedupe_group_id=p_group_id
    and (is_primary_listing is distinct from (v_winner is not null and id=v_winner)
      or duplicate_of_listing_id is distinct from
         (case when v_winner is null or id=v_winner then null else v_winner end));

  update public.listing_dedupe_groups
  set preferred_listing_id=v_winner,updated_at=now()
  where id=p_group_id and preferred_listing_id is distinct from v_winner;
  return v_winner;
end;
$function$;

insert into public.sources(
  id,source_type,name,tier,homepage_url,search_url,poll_interval_minutes,enabled,notes,
  button_label,delivery_mode,worker_slug,listing_priority,crawl_priority,coverage_strategy,
  runtime_mode,coverage_status,search_capabilities
)
overriding system value
values(
  66,'Baugenossenschaft','GEWOBA Nord','K1','https://www.gewoba-nord.de',
  'https://www.gewoba-nord.de/wohne-mit-uns/wohnungssuche/',5,true,
  'Official public Immomio inventory verified 2026-09-24; Hamburg-only filtering is enforced by source-worker/immomio.',
  'GEWOBA Nord','shadow','source-worker',5,66,'tenant_api','shadow','partial',
  '{"version":1,"evidence":"configured_adapter_scope","discovery":"public_search_or_inventory","offer_modes":["rent"],"configured_kinds":["apartment"],"additional_kinds_require_evidence":true}'::jsonb
)
on conflict(name) do update set
  homepage_url=excluded.homepage_url,search_url=excluded.search_url,worker_slug='source-worker',
  notes=excluded.notes,updated_at=now();

insert into public.source_connectors(
  id,source_id,priority,label,connector_kind,config,enabled,evidence_tier,connector_role,enumerable,shadow_only
)
overriding system value
select 186,id,1,'Immomio Tenant GraphQL','immomio_tenant',
  '{"url":"https://homepage.immomio.com/de/properties?token=eyJhbGciOiJIUzI1NiJ9.eyJjdXN0b21lcklkIjoxNDcxNTI4MzI3LCJjcmVhdGVkIjoxNzUwMjQyNDgxNTQyLCJpZCI6MTQ3Njg1MTM3OX0.mDHY0oNEEGimpBIq_ZdX1TPHmw1Jll3lq4O8beoF8eQ"}'::jsonb,
  true,'K1','primary',true,false
from public.sources where name='GEWOBA Nord'
on conflict(source_id,priority) do update set
  label=excluded.label,connector_kind=excluded.connector_kind,config=excluded.config,
  enabled=true,evidence_tier='K1',connector_role='primary',enumerable=true,shadow_only=false,updated_at=now();

insert into public.source_connectors(
  id,source_id,priority,label,connector_kind,config,enabled,evidence_tier,connector_role,enumerable,shadow_only
)
overriding system value
select 187,id,2,'Official provider wrapper / tenant rediscovery','immomio_tenant',
  '{"url":"https://www.gewoba-nord.de/wohne-mit-uns/wohnungssuche/","audit_role":"official_wrapper_recovery","audited_at":"2026-09-24"}'::jsonb,
  true,'K3','fallback',true,false
from public.sources where name='GEWOBA Nord'
on conflict(source_id,priority) do update set
  label=excluded.label,connector_kind=excluded.connector_kind,config=excluded.config,
  enabled=true,evidence_tier='K3',connector_role='fallback',enumerable=true,shadow_only=false,updated_at=now();

insert into public.sources(
  id,source_type,name,tier,homepage_url,search_url,poll_interval_minutes,enabled,notes,
  button_label,delivery_mode,worker_slug,listing_priority,crawl_priority,coverage_strategy,
  runtime_mode,coverage_status,search_capabilities
)
overriding system value
values(
  67,'Baugenossenschaft','NEUE LÜBECKER','K2','https://www.neueluebecker.de',
  'https://www.neueluebecker.de/mieten/immobilienangebote/',10,true,
  'Shadow-only Hamburg coverage. Official inventory and Immomio workflow verified; production requires a confirmed Hamburg-city listing.',
  'NEUE LÜBECKER','shadow','source-worker',6,67,'official_inventory_shadow','shadow','partial',
  '{"version":1,"evidence":"official_inventory_shadow","discovery":"public_search_or_inventory","offer_modes":["rent"],"configured_kinds":["apartment"],"additional_kinds_require_evidence":true}'::jsonb
)
on conflict(name) do update set
  homepage_url=excluded.homepage_url,search_url=excluded.search_url,worker_slug='source-worker',
  delivery_mode='shadow',runtime_mode='shadow',notes=excluded.notes,updated_at=now();

insert into public.source_connectors(
  id,source_id,priority,label,connector_kind,config,enabled,evidence_tier,connector_role,enumerable,shadow_only
)
overriding system value
select 188,id,1,'Official NEUE LÜBECKER inventory','html_discovery',
  '{"url":"https://www.neueluebecker.de/mieten/immobilienangebote/","audit_role":"official_inventory_shadow","audited_at":"2026-09-24"}'::jsonb,
  true,'K2','primary',false,false
from public.sources where name='NEUE LÜBECKER'
on conflict(source_id,priority) do update set
  label=excluded.label,connector_kind=excluded.connector_kind,config=excluded.config,
  enabled=true,evidence_tier='K2',connector_role='primary',enumerable=false,shadow_only=false,updated_at=now();

select setval(pg_get_serial_sequence('public.sources','id'),greatest((select max(id) from public.sources),67),true);
select setval(pg_get_serial_sequence('public.source_connectors','id'),greatest((select max(id) from public.source_connectors),188),true);
