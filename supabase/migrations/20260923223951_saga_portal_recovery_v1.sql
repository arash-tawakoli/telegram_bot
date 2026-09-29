
-- SAGA portal recovery V1:
-- * Immowelt + ImmoScout stay the discovery sources.
-- * SAGA MO reference is the cross-portal identity.
-- * >24h listings use a separate still_active event and never relax global newness.
-- * Recovery is queued only after a fresh Immomio availability verification.

alter table public.delivery_events
  drop constraint if exists delivery_events_event_type_check;

alter table public.delivery_events
  add constraint delivery_events_event_type_check
  check (event_type = any (array['new_listing'::text,'listing_changed'::text,'still_active'::text]));

create or replace function app_private.saga_object_ref(p_raw jsonb, p_evidence jsonb)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when v ~ '^MO [0-9]{4}/[A-Z0-9.-]+/[A-Z0-9.-]+$' then v
    else null
  end
  from (
    select upper(
      regexp_replace(
        regexp_replace(
          btrim(coalesce(
            p_raw->>'saga_object_ref',
            p_evidence#>>'{saga_probe,saga_object_ref}',
            p_evidence#>>'{preview,facts,saga_object_ref}',
            ''
          )),
          '[[:space:]]*/[[:space:]]*','/','g'
        ),
        '[[:space:]]+',' ','g'
      )
    ) as v
  ) x;
$$;

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
begin
  select * into c from public.listings where id=p_listing_id for update;
  if not found or c.quality_status='rejected' then return null; end if;
  v_old_group:=c.dedupe_group_id;
  v_target:=app_private.immomio_application_target(c.raw,c.canonical_url);
  v_sid:=case when v_target->>'status'='resolved' then v_target->>'source_identifier' end;
  v_saga_ref:=app_private.saga_object_ref(c.raw,c.enrichment_evidence);

  select l.dedupe_group_id into v_group
  from public.listings l
  where l.id<>c.id and l.is_active=true and l.quality_status<>'rejected'
    and l.dedupe_group_id is not null
    and (
      (v_saga_ref is not null and app_private.saga_object_ref(l.raw,l.enrichment_evidence)=v_saga_ref)
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
    -- Never bridge two known SAGA objects.
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
    -- Portal-specific Immomio UUIDs may differ for the same known SAGA MO object.
    and (
      (v_saga_ref is not null and app_private.saga_object_ref(l.raw,l.enrichment_evidence)=v_saga_ref)
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
    (v_saga_ref is not null and app_private.saga_object_ref(l.raw,l.enrichment_evidence)=v_saga_ref) desc,
    (l.dedupe_group_id=v_old_group) desc nulls last,
    l.first_seen_at,l.id
  limit 1;

  if v_group is null and v_old_group is not null
     and exists(select 1 from public.listing_dedupe_groups where id=v_old_group)
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
       (v_saga_ref is not null and exists(
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

create or replace function public.record_saga_probe(
  p_listing_id uuid,
  p_is_saga boolean,
  p_saga_ref text,
  p_application_url text,
  p_immomio_status text,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ref text;
  v_url text;
  v_probe jsonb;
  v_group uuid;
  v_primary boolean;
  v_next timestamptz;
begin
  if not exists(select 1 from public.listings where id=p_listing_id) then
    raise exception 'listing_not_found';
  end if;

  v_ref:=upper(regexp_replace(regexp_replace(btrim(coalesce(p_saga_ref,'')),'[[:space:]]*/[[:space:]]*','/','g'),'[[:space:]]+',' ','g'));
  if v_ref !~ '^MO [0-9]{4}/[A-Z0-9.-]+/[A-Z0-9.-]+$' then v_ref:=null; end if;

  v_url:=nullif(btrim(coalesce(p_application_url,'')),'');
  if v_url is not null and v_url !~* '^https://tenant[.]immomio[.]com/(de/)?apply/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/?$' then
    v_url:=null;
  end if;

  if p_error is not null then v_next:=statement_timestamp()+interval '1 hour'; end if;

  v_probe:=jsonb_strip_nulls(jsonb_build_object(
    'checked_at',statement_timestamp(),
    'status',case
      when p_error is not null then 'error'
      when coalesce(p_is_saga,false) then 'identified'
      else 'not_saga'
    end,
    'next_check_at',v_next,
    'is_saga',coalesce(p_is_saga,false),
    'saga_object_ref',v_ref,
    'application_url',v_url,
    'immomio_status',nullif(btrim(coalesce(p_immomio_status,'')),''),
    'error',nullif(left(coalesce(p_error,''),500),'')
  ));

  update public.listings
  set enrichment_evidence=jsonb_set(coalesce(enrichment_evidence,'{}'::jsonb),'{saga_probe}',v_probe,true),
      raw=case when coalesce(p_is_saga,false) then
        coalesce(raw,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'provider_entity','SAGA',
          'saga_object_ref',v_ref,
          'applicationLink',v_url
        ))
      else raw end
  where id=p_listing_id;

  if coalesce(p_is_saga,false) and v_ref is not null then
    v_group:=app_private.assign_listing_dedupe(p_listing_id);
  end if;

  select is_primary_listing,dedupe_group_id
    into v_primary,v_group
  from public.listings where id=p_listing_id;

  return jsonb_build_object(
    'ok',true,
    'is_saga',coalesce(p_is_saga,false),
    'saga_object_ref',v_ref,
    'application_url',v_url,
    'dedupe_group_id',v_group,
    'is_primary_listing',coalesce(v_primary,false)
  );
end
$function$;

revoke all on function public.record_saga_probe(uuid,boolean,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_saga_probe(uuid,boolean,text,text,text,text) to service_role;

create or replace function app_private.saga_recovery_probe_candidate_id()
returns uuid
language sql
stable
set search_path to ''
as $function$
  select l.id
  from public.listings l
  join public.sources s on s.id=l.source_id
  where l.source_id in (1,3)
    and l.is_active=true
    and coalesce(l.is_primary_listing,false)=true
    and coalesce(l.quality_status,'unchecked')<>'rejected'
    and l.first_seen_at < statement_timestamp()-interval '24 hours'
    and l.last_seen_at >= statement_timestamp()-interval '30 minutes'
    and s.enabled=true and s.runtime_mode='live' and s.delivery_mode='live'
    and (
      l.enrichment_evidence#>>'{saga_probe,status}' is null
      or (
        l.enrichment_evidence#>>'{saga_probe,status}'='error'
        and coalesce((l.enrichment_evidence#>>'{saga_probe,next_check_at}')::timestamptz,'-infinity'::timestamptz)<=statement_timestamp()
      )
    )
    and exists (
      select 1
      from public.search_profiles p
      join public.bot_users u on u.id=p.user_id and u.is_active=true
      where p.is_active=true
        and (p.profile_slot=1 or app_private.user_is_premium(p.user_id))
        and app_private.matches_property_filters(p,l)
        and not exists (
          select 1
          from public.delivery_events de
          join public.listings oldl on oldl.id=de.listing_id
          where de.recipient_user_id=p.user_id
            and de.status='sent'
            and oldl.dedupe_group_id=l.dedupe_group_id
        )
    )
  order by l.first_seen_at desc,l.id
  limit 1;
$function$;

create or replace function app_private.saga_recovery_probe_candidate_exists()
returns boolean
language sql
stable
set search_path to ''
as $function$
  select app_private.saga_recovery_probe_candidate_id() is not null;
$function$;

create or replace function public.next_saga_recovery_probe_candidate()
returns uuid
language sql
security definer
set search_path to ''
as $function$
  select app_private.saga_recovery_probe_candidate_id();
$function$;

revoke all on function public.next_saga_recovery_probe_candidate() from public,anon,authenticated;
grant execute on function public.next_saga_recovery_probe_candidate() to service_role;

create or replace function public.saga_delivery_already_received(
  p_user_id uuid,
  p_saga_ref text,
  p_exclude_event_id uuid default null
)
returns boolean
language sql
security definer
set search_path to ''
as $function$
  select exists(
    select 1
    from public.delivery_events de
    join public.listings l on l.id=de.listing_id
    where de.recipient_user_id=p_user_id
      and de.status='sent'
      and (p_exclude_event_id is null or de.id<>p_exclude_event_id)
      and app_private.saga_object_ref(l.raw,l.enrichment_evidence)
        = upper(regexp_replace(regexp_replace(btrim(p_saga_ref),'[[:space:]]*/[[:space:]]*','/','g'),'[[:space:]]+',' ','g'))
  );
$function$;

revoke all on function public.saga_delivery_already_received(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.saga_delivery_already_received(uuid,text,uuid) to service_role;

create or replace function public.queue_saga_recovery(p_listing_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  l public.listings%rowtype;
  v_ref text;
  v_status text;
  v_checked timestamptz;
  v_count integer:=0;
begin
  select * into l from public.listings where id=p_listing_id;
  if not found then return 0; end if;

  v_ref:=app_private.saga_object_ref(l.raw,l.enrichment_evidence);
  v_status:=l.enrichment_evidence#>>'{saga_probe,immomio_status}';
  begin
    v_checked:=(l.enrichment_evidence#>>'{saga_probe,checked_at}')::timestamptz;
  exception when others then
    v_checked:=null;
  end;

  if l.source_id not in (1,3)
     or not l.is_active
     or not coalesce(l.is_primary_listing,false)
     or coalesce(l.quality_status,'unchecked')='rejected'
     or l.first_seen_at >= statement_timestamp()-interval '24 hours'
     or v_ref is null
     or v_status<>'online'
     or v_checked is null
     or v_checked < statement_timestamp()-interval '10 minutes'
  then
    return 0;
  end if;

  insert into public.delivery_events(
    profile_id,listing_id,dedupe_key,status,delivery_format,
    recipient_user_id,event_type,next_retry_at,channel
  )
  select
    p.id,
    l.id,
    'saga:'||v_ref,
    case when u.telegram_user_id is not null and u.chat_id is not null then 'pending' else 'available' end,
    case when u.telegram_user_id is not null and u.chat_id is not null then 'photo_card' else 'web_match' end,
    p.user_id,
    'still_active',
    null,
    case when u.telegram_user_id is not null and u.chat_id is not null then 'telegram' else 'web' end
  from public.search_profiles p
  join public.bot_users u on u.id=p.user_id and u.is_active=true
  where p.is_active=true
    and (p.profile_slot=1 or app_private.user_is_premium(p.user_id))
    and app_private.matches_property_filters(p,l)
    and not exists (
      select 1
      from public.delivery_events de
      join public.listings oldl on oldl.id=de.listing_id
      where de.recipient_user_id=p.user_id
        and de.status='sent'
        and (
          app_private.saga_object_ref(oldl.raw,oldl.enrichment_evidence)=v_ref
          or oldl.dedupe_group_id=l.dedupe_group_id
        )
    )
  on conflict do nothing;

  get diagnostics v_count=row_count;
  return v_count;
end
$function$;

revoke all on function public.queue_saga_recovery(uuid) from public,anon,authenticated;
grant execute on function public.queue_saga_recovery(uuid) to service_role;

-- "Wohnen auf Zeit" is a WG-mode search in the product taxonomy.
create or replace function app_private.classify_listing_category(
  p_source_id bigint,
  p_property_type text,
  p_property_kind text,
  p_offer_mode text,
  p_title text,
  p_raw jsonb
)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_caps jsonb := '{}'::jsonb;
  v_c jsonb := coalesce(p_raw,'{}'::jsonb)->'_classification';
  v_text text := lower(concat_ws(' ',
    coalesce(p_title,''),
    coalesce(p_raw->>'text',''),
    coalesce(p_raw->>'alt',''),
    coalesce(p_raw->>'query',''),
    coalesce(p_raw#>>'{entry,title}','')
  ));
  v_provider text := lower(coalesce(p_raw->>'provider',''));
  v_stream text := lower(coalesce(p_raw->>'category_stream',''));
  v_kind text := null;
  v_mode text := null;
  v_category text := null;
  v_kind_evidence text := null;
  v_mode_evidence text := null;
  v_kinds jsonb := '[]'::jsonb;
  v_modes jsonb := '[]'::jsonb;
begin
  select coalesce(search_capabilities,'{}'::jsonb)
    into v_caps
  from public.sources
  where id=p_source_id;

  v_kinds:=coalesce(v_caps->'configured_kinds','[]'::jsonb);
  v_modes:=coalesce(v_caps->'offer_modes','[]'::jsonb);

  if coalesce(v_c->>'version','')='4'
     and v_c->>'kind' in ('apartment','house','room')
     and v_c->>'mode' in ('rent','swap','sale','wanted') then
    v_kind:=v_c->>'kind';
    v_mode:=v_c->>'mode';
    v_kind_evidence:='source_classification';
    v_mode_evidence:='source_classification';
  else
    if coalesce(p_offer_mode,'') in ('sale','wanted') then
      v_mode:=p_offer_mode;
      v_mode_evidence:='stored_mode';
    elsif v_text ~ '(^|[[:space:]])(ich|wir)[[:space:]]+suche(n)?[[:space:]].{0,50}(wohnung|apartment|wg[[:space:]-]*zimmer|zimmer|haus)'
       or v_text ~ '(^|[[:space:]])(wohnung|apartment|wg[[:space:]-]*zimmer|zimmer|haus)[[:space:]]+gesucht([[:space:]]|$)'
       or v_text ~ '^[[:space:]]*suche[[:space:]]+(eine[nrsm]?[[:space:]]+|nach[[:space:]]+)?(wohnung|apartment|wg[[:space:]-]*zimmer|zimmer|haus)([[:space:]]|$)' then
      v_mode:='wanted'; v_mode_evidence:='text_wanted';
    elsif v_text ~ '(^|[[:space:]])(zum[[:space:]]+kauf|kaufpreis|zu[[:space:]]+verkaufen|verkauf|mietkauf|erbpacht)([[:space:]]|$)' then
      v_mode:='sale'; v_mode_evidence:='text_sale';
    elsif p_property_type='Tauschwohnung'
       or p_offer_mode='swap'
       or (
         v_text ~ '(tauschwohnung|tauschangebot|wohnungstausch|wohnung[[:space:]-]*tausch|(^|[[:space:]])tausche([[:space:]]|$)|(^|[[:space:]])tauschen([[:space:]]|$)|nur[[:space:]]+tauschen)'
         and v_text !~ '(kein(e|en)?|ohne)[[:space:]]+(tauschwohnung|wohnungstausch|tausch)'
       ) then
      v_mode:='swap';
      v_mode_evidence:=case when p_property_type='Tauschwohnung' then 'stored_category' when p_offer_mode='swap' then 'stored_mode' else 'text_swap' end;
    elsif p_offer_mode='rent' then
      v_mode:='rent'; v_mode_evidence:='stored_mode';
    elsif jsonb_array_length(v_modes)=1 and v_modes->>0 in ('rent','swap') then
      v_mode:=v_modes->>0; v_mode_evidence:='source_scope';
    elsif upper(coalesce(p_raw#>>'{entry,price,marketingType}',''))='RENT'
       or v_text ~ '(^|[[:space:]])(zur[[:space:]]+miete|vermietung|vermiete|mieten|untermiete|zwischenmiete)([[:space:]]|$)' then
      v_mode:='rent'; v_mode_evidence:='text_rent';
    else
      v_mode:='unknown'; v_mode_evidence:='insufficient';
    end if;

    if coalesce(p_property_kind,'') in ('apartment','house','room') then
      v_kind:=p_property_kind; v_kind_evidence:='stored_kind';
    elsif v_stream='room' then
      v_kind:='room'; v_kind_evidence:='room_stream';
    elsif v_stream='house' then
      v_kind:='house'; v_kind_evidence:='house_stream';
    elsif v_text ~ '(wg[[:space:]-]*zimmer|zimmer[[:space:]]+in[[:space:]]+(einer[[:space:]]+)?wg|zimmer.{0,60}[0-9]+er.{0,24}wg|privatzimmer|untermietzimmer|mitbewohner(in)?([[:space:]]|$)|zimmer.{0,40}gemeinschafts(küche|bad))' then
      v_kind:='room'; v_kind_evidence:='text_room';
    elsif v_text ~ '(^|[^[:alnum:]])(einfamilienhaus|reihenhaus|doppelhaus|doppelhaushälfte|bungalow|villa|stadthaus|haus[[:space:]]+zur[[:space:]]+miete|haus[[:space:]]+mieten)([^[:alnum:]]|$)' then
      v_kind:='house'; v_kind_evidence:='text_house';
    elsif v_text ~ '(wohnung|whg([^[:alnum:]]|$)|zi[.]?[[:space:]-]*whg([^[:alnum:]]|$)|zimmerwohnung|apartment|appartment|penthouse|maisonette|loft|studio|etagenwohnung|terrassenwohnung|dachgeschosswohnung|erdgeschosswohnung)' then
      v_kind:='apartment'; v_kind_evidence:='text_apartment';
    elsif p_property_type in ('Wohnung','Haus','WG') then
      v_kind:=case p_property_type when 'Wohnung' then 'apartment' when 'Haus' then 'house' else 'room' end;
      v_kind_evidence:='stored_category';
    elsif p_property_type='Tauschwohnung' then
      if jsonb_array_length(v_kinds)=1 and v_kinds->>0 in ('apartment','house','room') then
        v_kind:=v_kinds->>0; v_kind_evidence:='source_scope';
      else
        v_kind:='apartment'; v_kind_evidence:='stored_category';
      end if;
    elsif jsonb_array_length(v_kinds)=1 and v_kinds->>0 in ('apartment','house','room') then
      v_kind:=v_kinds->>0; v_kind_evidence:='source_scope';
    elsif v_provider='kleinanzeigen'
       and coalesce((p_raw->>'native_offer')::boolean,false)
       and v_stream='' then
      v_kind:='apartment'; v_kind_evidence:='provider_default_apartment';
    elsif v_provider='wunderflats_catalog' then
      v_kind:='apartment'; v_kind_evidence:='provider_default_apartment';
    elsif v_mode='swap' then
      v_kind:='apartment'; v_kind_evidence:='swap_default';
    else
      v_kind:='unknown'; v_kind_evidence:='insufficient';
    end if;
  end if;

  -- Product rule: explicit "Wohnen auf Zeit" belongs to WG, even if a portal
  -- technically models the unit as an apartment.
  if v_mode='rent'
     and v_text ~ '(wohnen[[:space:]-]+auf[[:space:]-]+zeit|zeitwohnen|temporary[[:space:]-]+rent)' then
    v_kind:='room';
    v_kind_evidence:='temporary_housing_to_wg';
  end if;

  v_category:=case
    when v_mode='swap' and v_kind in ('apartment','house','room') then 'Tauschwohnung'
    when v_mode='rent' and v_kind='apartment' then 'Wohnung'
    when v_mode='rent' and v_kind='house' then 'Haus'
    when v_mode='rent' and v_kind='room' then 'WG'
    else null
  end;

  return jsonb_build_object(
    'version',4,
    'kind',coalesce(v_kind,'unknown'),
    'mode',coalesce(v_mode,'unknown'),
    'category',v_category,
    'kind_evidence',coalesce(v_kind_evidence,'insufficient'),
    'mode_evidence',coalesce(v_mode_evidence,'insufficient')
  );
end
$function$;

-- Let the existing dispatcher cron wake up for exactly one recovery probe even
-- when there are no normal delivery events. It stays idle once the backlog is classified.
select cron.alter_job(
  4,
  command := $cron$
select app_private.prepare_current_delivery_queue()
where exists (
  select 1
  from public.delivery_events
  where status in ('pending','failed')
    and delivery_outcome_unknown=false
    and dispatch_attempts<5
    and (next_retry_at is null or next_retry_at<=now())
);
select net.http_post(
  url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/notification-dispatcher',
  headers:=jsonb_build_object(
    'Content-Type','application/json',
    'x-internal-secret',public.get_bot_secret('internal_worker_secret')
  ),
  body:='{}'::jsonb,
  timeout_milliseconds:=145000
)
where exists (
  select 1 from public.delivery_events
  where (
    status in ('pending','failed')
    and delivery_outcome_unknown=false
    and dispatch_attempts<5
    and (next_retry_at is null or next_retry_at<=now())
  ) or (
    status='processing'
    and last_attempt_at<now()-interval '10 minutes'
  )
)
or app_private.saga_recovery_probe_candidate_exists();
$cron$
);
