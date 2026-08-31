create or replace function app_private.prepare_listing_fast_delivery()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_existing_eligible boolean;
  v_baseline_completed_at timestamptz;
begin
  new.enrichment_status := 'done';
  new.enrichment_delivery_eligible := true;
  new.enrichment_error := null;

  if new.source_id in (5, 15, 16) then
    select l.fresh_delivery_eligible
      into v_existing_eligible
    from public.listings l
    where l.source_id = new.source_id
      and l.source_listing_key = new.source_listing_key
    limit 1;

    if found then
      new.fresh_delivery_eligible := coalesce(v_existing_eligible, false);
    else
      select s.baseline_completed_at
        into v_baseline_completed_at
      from public.sources s
      where s.id = new.source_id;

      if v_baseline_completed_at is not null then
        new.fresh_delivery_eligible := true;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

update public.source_connectors
set label='Vonovia Immowelt Transport',
    connector_kind='json_endpoint',
    enumerable=false,
    enabled=true,
    shadow_only=false,
    config=jsonb_build_object(
      'url','https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/vonovia-transport',
      'provider','Vonovia Kundenservice GmbH',
      'transport','supabase_vonovia_transport'
    )
where source_id=5 and priority=1;

update public.source_connectors
set enabled=false,shadow_only=true
where source_id=5 and priority in (2,3);

update public.sources
set search_url='https://www.vonovia.de/zuhause-finden',
    coverage_strategy='provider_mirror',
    baseline_completed_at=null,
    coverage_status='partial',
    last_error_at=null,
    consecutive_failures=0,
    updated_at=now()
where id=5;
