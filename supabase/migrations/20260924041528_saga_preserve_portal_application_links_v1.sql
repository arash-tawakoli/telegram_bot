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
  v_status text;
  v_error text;
  v_shared_from uuid;
  v_verified_source uuid;
  v_propagated integer:=0;
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

  v_status:=nullif(btrim(coalesce(p_immomio_status,'')),'');
  v_error:=nullif(left(coalesce(p_error,''),500),'');

  if coalesce(p_is_saga,false) and v_ref is not null and v_url is null then
    select l.id,
           coalesce(
             nullif(l.raw->>'applicationLink',''),
             nullif(l.enrichment_evidence#>>'{saga_probe,application_url}',''),
             nullif(l.enrichment_evidence#>>'{saga_shared,application_url}','')
           )
      into v_shared_from,v_url
    from public.listings l
    where l.id<>p_listing_id
      and app_private.saga_object_ref(l.raw,l.enrichment_evidence)=v_ref
      and (
        l.enrichment_evidence#>>'{saga_probe,immomio_status}'='online'
        or l.enrichment_evidence#>>'{saga_shared,verified}'='true'
      )
      and coalesce(
        nullif(l.raw->>'applicationLink',''),
        nullif(l.enrichment_evidence#>>'{saga_probe,application_url}',''),
        nullif(l.enrichment_evidence#>>'{saga_shared,application_url}','')
      ) ~* '^https://tenant[.]immomio[.]com/(de/)?apply/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/?$'
    order by greatest(
      coalesce((l.enrichment_evidence#>>'{saga_probe,checked_at}')::timestamptz,'-infinity'::timestamptz),
      coalesce((l.enrichment_evidence#>>'{saga_shared,verified_at}')::timestamptz,'-infinity'::timestamptz)
    ) desc
    limit 1;

    if v_url is not null then
      v_status:='online';
      v_error:=null;
    end if;
  end if;

  if v_error is not null then
    v_next:=statement_timestamp()+interval '1 hour';
  end if;

  v_probe:=jsonb_strip_nulls(jsonb_build_object(
    'checked_at',statement_timestamp(),
    'status',case
      when v_error is not null then 'error'
      when coalesce(p_is_saga,false) then 'identified'
      else 'not_saga'
    end,
    'next_check_at',v_next,
    'is_saga',coalesce(p_is_saga,false),
    'saga_object_ref',v_ref,
    'application_url',v_url,
    'immomio_status',v_status,
    'verification_source',case when v_shared_from is not null then 'shared_mo_ref' else 'direct' end,
    'error',v_error
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

  if coalesce(p_is_saga,false)
     and v_ref is not null
     and v_url is not null
     and v_status='online'
  then
    v_verified_source:=coalesce(v_shared_from,p_listing_id);

    update public.listings l
    set raw=(
          coalesce(l.raw,'{}'::jsonb)
          || jsonb_build_object('provider_entity','SAGA','saga_object_ref',v_ref)
          || case
               when coalesce(l.raw->>'applicationLink','') ~* '^https://tenant[.]immomio[.]com/(de/)?apply/[0-9a-f-]{36}/?$'
                 then '{}'::jsonb
               else jsonb_build_object('applicationLink',v_url)
             end
        ),
        enrichment_evidence=jsonb_set(
          coalesce(l.enrichment_evidence,'{}'::jsonb),
          '{saga_shared}',
          jsonb_build_object(
            'verified',true,
            'application_url',v_url,
            'verified_at',statement_timestamp(),
            'verified_source_listing_id',v_verified_source
          ),
          true
        )
    where app_private.saga_object_ref(l.raw,l.enrichment_evidence)=v_ref
      and (
        coalesce(l.raw->>'applicationLink','') !~* '^https://tenant[.]immomio[.]com/(de/)?apply/[0-9a-f-]{36}/?$'
        or l.enrichment_evidence#>>'{saga_shared,verified}' is distinct from 'true'
        or l.enrichment_evidence#>>'{saga_shared,application_url}' is distinct from v_url
      );

    get diagnostics v_propagated=row_count;
  end if;

  select is_primary_listing,dedupe_group_id
    into v_primary,v_group
  from public.listings where id=p_listing_id;

  return jsonb_build_object(
    'ok',true,
    'is_saga',coalesce(p_is_saga,false),
    'saga_object_ref',v_ref,
    'application_url',v_url,
    'immomio_status',v_status,
    'inherited_from_listing_id',v_shared_from,
    'propagated_count',v_propagated,
    'dedupe_group_id',v_group,
    'is_primary_listing',coalesce(v_primary,false)
  );
end
$function$;

revoke all on function public.record_saga_probe(uuid,boolean,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_saga_probe(uuid,boolean,text,text,text,text) to service_role;
