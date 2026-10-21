CREATE OR REPLACE FUNCTION app_private.record_source_neighborhood_coverage(p_source_id integer, p_neighborhood_id smallint, p_search_status text, p_result_count integer DEFAULT NULL::integer, p_strategy text DEFAULT NULL::text, p_evidence_quality text DEFAULT 'unknown'::text, p_evidence jsonb DEFAULT '{}'::jsonb, p_attempted_at timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_attempted_at timestamptz := coalesce(p_attempted_at,now());
begin
  if p_search_status not in ('searched_with_hits','searched_no_hits','not_searchable','ambiguous') then raise exception 'invalid_neighborhood_search_status'; end if;
  if p_result_count is not null and p_result_count < 0 then raise exception 'invalid_neighborhood_result_count'; end if;
  if p_search_status='searched_with_hits' and p_result_count=0 then raise exception 'hits_status_requires_positive_result_count'; end if;
  if p_search_status='searched_no_hits' and p_result_count>0 then raise exception 'no_hits_status_requires_zero_result_count'; end if;
  if p_evidence_quality not in ('official','verified','inferred','weak','unknown') then raise exception 'invalid_neighborhood_evidence_quality'; end if;
  if jsonb_typeof(coalesce(p_evidence,'{}'::jsonb)) <> 'object' then raise exception 'neighborhood_evidence_must_be_object'; end if;
  insert into app_private.source_neighborhood_coverage(source_id,neighborhood_id,search_status,result_count,last_attempt_at,last_success_at,strategy,evidence_quality,evidence)
  values(p_source_id,p_neighborhood_id,p_search_status,p_result_count,v_attempted_at,
    case when p_search_status in ('searched_with_hits','searched_no_hits') then v_attempted_at else null end,
    nullif(left(trim(coalesce(p_strategy,'')),120),''),p_evidence_quality,coalesce(p_evidence,'{}'::jsonb))
  on conflict(source_id,neighborhood_id) do update set
    search_status=excluded.search_status,result_count=excluded.result_count,last_attempt_at=excluded.last_attempt_at,
    last_success_at=case when excluded.search_status in ('searched_with_hits','searched_no_hits') then excluded.last_attempt_at else app_private.source_neighborhood_coverage.last_success_at end,
    strategy=excluded.strategy,evidence_quality=excluded.evidence_quality,evidence=excluded.evidence,updated_at=now()
  where not (
    app_private.source_neighborhood_coverage.search_status in ('searched_with_hits','searched_no_hits')
    and app_private.source_neighborhood_coverage.evidence_quality in ('official','verified')
    and excluded.search_status in ('ambiguous','not_searchable')
    and excluded.evidence_quality in ('weak','unknown')
  )
  and (
    app_private.source_neighborhood_coverage.last_attempt_at < now()-interval '24 hours'
    or app_private.source_neighborhood_coverage.search_status is distinct from excluded.search_status
    or app_private.source_neighborhood_coverage.result_count is distinct from excluded.result_count
    or app_private.source_neighborhood_coverage.strategy is distinct from excluded.strategy
    or app_private.source_neighborhood_coverage.evidence_quality is distinct from excluded.evidence_quality
  );
end;
$function$
;
revoke all on function app_private.record_source_neighborhood_coverage(integer,smallint,text,integer,text,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function app_private.record_source_neighborhood_coverage(integer,smallint,text,integer,text,text,jsonb,timestamptz) to service_role;
