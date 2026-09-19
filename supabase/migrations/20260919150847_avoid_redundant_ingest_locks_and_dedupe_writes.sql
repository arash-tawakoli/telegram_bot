set local lock_timeout='3s';
set local statement_timeout='30s';

-- Keep the source-level advisory lock and the row locks acquired by actual
-- UPDATE / INSERT ON CONFLICT. Read-only observations must not dirty every row.
do $migration$
declare
  definition text;
  old_block text := E'  perform 1\n  from public.listings l\n  where l.source_id = p_source_id\n    and l.source_listing_key in (\n      select x->>''source_listing_key'' from jsonb_array_elements(p_rows) x\n    )\n  order by l.id\n  for update;\n';
  old_touch text := E'    where c.unchanged\n      and l.id = c.id\n';
begin
  definition := pg_get_functiondef('public.ingest_listing_batch_v3(smallint,jsonb,timestamptz)'::regprocedure);
  if position(old_block in definition)=0 or position(old_touch in definition)=0 then
    raise exception 'Unexpected ingest function version; refusing patch';
  end if;
  definition := replace(definition,old_block,E'  -- Unchanged observations do not take a write-producing row lock.\n');
  definition := replace(definition,old_touch,E'    where c.unchanged\n      and l.id = c.id\n      and l.is_active = true\n      and l.ingest_fingerprint = c.fingerprint\n');
  execute definition;
end;
$migration$;

-- Preserve the exact existing winner-selection semantics and function ACL.
create or replace function app_private.refresh_listing_dedupe_group(p_group_id uuid)
returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_winner uuid;
begin
  if p_group_id is null then return null; end if;
  select l.id into v_winner
  from public.listings l join public.sources s on s.id=l.source_id
  where l.dedupe_group_id=p_group_id and l.is_active=true
    and l.quality_status<>'rejected'
  order by s.listing_priority asc,
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