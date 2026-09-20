
create or replace function public.record_telegram_fast_metric(p_update_id bigint,p_metrics jsonb)
returns boolean language plpgsql set search_path='' as $fn$
declare safe jsonb; region text;
begin
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into safe
 from jsonb_each(coalesce(p_metrics,'{}'::jsonb))
 where key in('db_ms','render_ms','ack_ms','response_ms','telegram_ms','total_ms','rpc_count','telegram_count','busy_count','fast_path')
   and jsonb_typeof(value)='number' and value::numeric between 0 and 600000;
 region:=left(coalesce(p_metrics->>'edge_region',''),32);
 if region~'^[a-z0-9-]{2,32}$' then safe:=safe||jsonb_build_object('edge_region',region); end if;
 update public.bot_events set ui_timings=coalesce(ui_timings,'{}'::jsonb)||safe
 where telegram_update_id=p_update_id and processing_status='done';
 return found;
end $fn$;

create or replace function public.record_telegram_static_nav(p_payload jsonb,p_metrics jsonb)
returns boolean language plpgsql set search_path='' as $fn$
declare
 v_update bigint:=nullif(p_payload->>'update_id','')::bigint;
 v_user bigint:=nullif(p_payload#>>'{callback_query,from,id}','')::bigint;
 v_action text:=coalesce(p_payload#>>'{callback_query,data}','');
 safe jsonb; region text;
begin
 if v_update is null or v_user is null or v_action not in('home:de','settings:de','help:de') then return false;end if;
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into safe
 from jsonb_each(coalesce(p_metrics,'{}'::jsonb))
 where key in('db_ms','render_ms','ack_ms','response_ms','telegram_ms','total_ms','rpc_count','telegram_count','busy_count','fast_path')
   and jsonb_typeof(value)='number' and value::numeric between 0 and 600000;
 region:=left(coalesce(p_metrics->>'edge_region',''),32);
 if region~'^[a-z0-9-]{2,32}$' then safe:=safe||jsonb_build_object('edge_region',region); end if;
 insert into public.bot_events(telegram_update_id,event_type,telegram_user_id,payload,processing_status,processing_attempt,processing_at,ui_timings)
 values(v_update,'callback_query',v_user,jsonb_build_object('update_id',v_update,'callback_query',jsonb_build_object('data',v_action)),'done',1,now(),safe)
 on conflict(telegram_update_id) do update set ui_timings=coalesce(public.bot_events.ui_timings,'{}'::jsonb)||excluded.ui_timings;
 return true;
end $fn$;

revoke all on function public.record_telegram_fast_metric(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.record_telegram_fast_metric(bigint,jsonb) to service_role;
revoke all on function public.record_telegram_static_nav(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_telegram_static_nav(jsonb,jsonb) to service_role;
