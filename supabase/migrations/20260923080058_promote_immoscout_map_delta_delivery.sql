create or replace function app_private.delivery_newness_qualified(
  p_listing_id uuid,
  p_as_of timestamptz default now()
) returns boolean
language plpgsql stable
set search_path=''
as $function$
declare
  l public.listings%rowtype;
  c app_private.source_category_streams%rowtype;
  published timestamptz;
  proof jsonb;
begin
  select * into l from public.listings where id=p_listing_id;
  if not found then return false; end if;

  if l.source_id=1 and coalesce(l.raw->>'delivery_lane','')='map_delta' then
    if not coalesce(l.fresh_delivery_eligible,false)
       or l.first_seen_at is null
       or l.first_seen_at < p_as_of-interval '24 hours'
       or l.first_seen_at > p_as_of+interval '5 minutes'
    then return false; end if;
    proof:=l.raw->'_newness';
    if proof->>'method'<>'map_snapshot_delta' or proof->>'observed_at' is null then return false; end if;
    begin published:=(proof->>'observed_at')::timestamptz;
    exception when others then return false; end;
    return published>=p_as_of-interval '24 hours'
       and published<=p_as_of+interval '5 minutes'
       and l.first_seen_at>=published-interval '5 minutes';
  end if;

  if l.raw ? 'category_stream' then
    select * into c
    from app_private.source_category_streams
    where source_id=l.source_id and category=l.raw->>'category_stream';

    if not found
       or not c.enabled
       or c.verified_at is null
       or c.baseline_at is null
       or not coalesce(l.fresh_delivery_eligible,false)
       or l.first_seen_at<c.baseline_at
       or l.first_seen_at<p_as_of-interval '24 hours'
       or l.first_seen_at>p_as_of+interval '5 minutes'
    then return false; end if;

    proof:=l.raw->'_newness';
    if proof->>'method'='source_timestamp' then
      begin published:=(proof->>'source_published_at')::timestamptz;
      exception when others then return false; end;
    elsif proof->>'method'='complete_snapshot_delta' and proof->>'previous_complete_at' is not null then
      begin published:=(proof->>'previous_complete_at')::timestamptz;
      exception when others then return false; end;
      if published<c.baseline_at or l.first_seen_at<published then return false; end if;
    elsif proof->>'method'='poll_delta' and proof->>'previous_success_at' is not null then
      begin published:=(proof->>'previous_success_at')::timestamptz;
      exception when others then return false; end;
      if published<c.baseline_at or l.first_seen_at<published then return false; end if;
    else return false;
    end if;

    return coalesce(published>=p_as_of-interval '24 hours' and published<=p_as_of+interval '5 minutes',false);
  end if;

  return app_private.delivery_newness_qualified_legacy(p_listing_id,p_as_of);
end
$function$;

drop trigger if exists listings_queue_delivery_on_fresh_promotion on public.listings;
create trigger listings_queue_delivery_on_fresh_promotion
after update of fresh_delivery_eligible on public.listings
for each row
when (
  new.source_id=1
  and old.fresh_delivery_eligible is distinct from true
  and new.fresh_delivery_eligible is true
)
execute function app_private.queue_listing_delivery_v3();
