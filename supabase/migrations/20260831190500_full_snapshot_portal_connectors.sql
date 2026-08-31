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

  if new.source_id in (15, 16) then
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
      new.fresh_delivery_eligible := (v_baseline_completed_at is not null);
    end if;
  end if;

  return new;
end;
$function$;

update public.source_connectors
set label='immobilien.de Full Snapshot Transport',
    connector_kind='json_endpoint',
    enumerable=true,
    enabled=true,
    shadow_only=false,
    connector_role='primary',
    evidence_tier='K1',
    config=jsonb_build_object(
      'url','https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/immobilien-de-transport',
      'transport','supabase_immobilien_de_transport',
      'mode','full_snapshot'
    )
where source_id=15 and priority=1;

update public.source_connectors
set enabled=false, shadow_only=true, connector_role='fallback'
where source_id=15 and priority in (2,3);

update public.source_connectors
set label='immobilie1 Full Snapshot Transport',
    connector_kind='json_endpoint',
    enumerable=true,
    enabled=true,
    shadow_only=false,
    connector_role='primary',
    evidence_tier='K1',
    config=jsonb_build_object(
      'url','https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/immobilie1-transport',
      'transport','supabase_immobilie1_transport',
      'mode','full_snapshot'
    )
where source_id=16 and priority=1;

update public.source_connectors
set enabled=false, shadow_only=true, connector_role='fallback'
where source_id=16 and priority in (2,3);

update public.sources
set coverage_strategy='full_page',
    baseline_completed_at=null,
    coverage_status='partial',
    last_error_at=null,
    consecutive_failures=0,
    updated_at=now()
where id in (15,16);
