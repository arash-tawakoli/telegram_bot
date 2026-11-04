create or replace function public.source_allowed_for_search(p_source_id smallint)
returns boolean
language sql
stable
set search_path = public, app_private
as $$
  select exists (
    select 1
    from public.sources s
    where s.id = p_source_id
      and (
        s.name ilike '%ImmobilienScout24%'
        or s.name ilike '%Immowelt%'
        or exists (
          select 1
          from public.source_connectors c
          where c.source_id = s.id
            and c.connector_kind = 'immomio_tenant'
        )
        or (
          exists (
            select 1
            from public.source_connectors c
            where c.source_id = s.id
              and c.config::text ilike '%tenant.immomio%'
          )
          and exists (
            select 1
            from public.listings l
            join public.delivery_events d on d.listing_id = l.id
            where l.source_id = s.id
              and d.status = 'sent'
          )
        )
      )
  );
$$;

comment on function public.source_allowed_for_search(smallint)
is 'Allowlist for the housing search runtime: ImmoScout24, Immowelt, Immomio tenant connectors, and tenant.immomio sources with proven sent delivery.';

update public.source_connectors c
set enabled = false,
    enumerable = false,
    shadow_only = true,
    connector_role = 'monitoring',
    label = 'Retired search connector',
    config = jsonb_build_object('retired', true),
    updated_at = now()
where not public.source_allowed_for_search(c.source_id);

update public.sources s
set enabled = false,
    runtime_mode = 'shadow',
    delivery_mode = 'shadow',
    worker_slug = null,
    notes = concat_ws(' ', nullif(s.notes,''), 'Retired by allowed-search-source policy on 2026-11-04. Historical rows retained for audit; no new crawl or delivery is permitted.'),
    updated_at = now()
where not public.source_allowed_for_search(s.id);

update public.source_jobs j
set status = 'dead',
    finished_at = coalesce(j.finished_at, now()),
    error_message = 'source retired by allowed-search-source policy',
    updated_at = now()
where j.status = 'enqueued'
  and not public.source_allowed_for_search(j.source_id);

update app_private.source_category_streams s
set enabled = false,
    url = null,
    last_error = 'source retired by allowed-search-source policy'
where not public.source_allowed_for_search(s.source_id);

create or replace function public.source_category_status()
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'sources',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', id,
            'name', name,
            'live', enabled and runtime_mode = 'live' and delivery_mode = 'live',
            'capabilities', search_capabilities
          )
          order by id
        ),
        '[]'::jsonb
      )
      from public.sources
      where public.source_allowed_for_search(id)
    ),
    'streams',
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'source_id', source_id,
            'category', category,
            'enabled', enabled,
            'verified_at', verified_at,
            'baseline_at', baseline_at,
            'last_success_at', last_success_at,
            'error', last_error
          )
          order by source_id, category
        ),
        '[]'::jsonb
      )
      from app_private.source_category_streams
      where public.source_allowed_for_search(source_id)
    )
  );
$fn$;