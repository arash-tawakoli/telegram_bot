CREATE OR REPLACE FUNCTION public.save_ui_state(p_user uuid, p_update_id bigint, p_attempt integer, p_step text, p_state jsonb, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare u public.bot_users%rowtype;current_revision integer;result jsonb;
begin
 select * into u from public.bot_users where id=p_user for update;
 if not found or not u.is_active or not exists(select 1 from public.bot_events where telegram_update_id=p_update_id and telegram_user_id=u.telegram_user_id and processing_status='processing' and processing_attempt=p_attempt) then raise exception 'ui_lease_lost';end if;
 if p_state is null or jsonb_typeof(p_state)<>'object' or octet_length(p_state::text)>24000 or p_step not in ('types','location','boroughs','neighborhoods','rent','rent_custom','rooms','area','roomarea','options','review','applicant_setup','shareas') then
  if p_step is not null then raise exception 'invalid_ui_state';end if;
 end if;
 current_revision:=coalesce((u.onboarding_state->>'_revision')::integer,0);
 if current_revision<>p_revision then raise exception 'ui_state_changed';end if;
 if u.onboarding_step is not distinct from p_step and (coalesce(u.onboarding_state,'{}')-'_revision')=(coalesce(p_state,'{}')-'_revision') then return coalesce(u.onboarding_state,'{}');end if;
 result:=case when p_step is null then '{}'::jsonb else jsonb_set(p_state,'{_revision}',to_jsonb(current_revision+1),true) end;
 update public.bot_users set onboarding_step=p_step,onboarding_state=result,updated_at=now() where id=p_user;
 return result;
end $function$
