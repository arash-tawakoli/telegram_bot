-- Apply only after migration-history reconciliation. Deploy source-worker afterward.
-- The ten-minute claim lease exceeds the hosted Edge Function maximum lifetime.
CREATE OR REPLACE FUNCTION public.complete_referral_reward(p_referred_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_referral public.referrals%rowtype;
  v_referred_until timestamptz;
  v_referrer_until timestamptz;
  v_referred_chat_id bigint;
begin
  -- This operation is server-only; qualification must also hold in the DB.
  if not exists (
    select 1 from public.search_profiles where user_id = p_referred_user_id
  ) then
    return jsonb_build_object('status', 'not_qualified');
  end if;
  select * into v_referral
  from public.referrals r
  where r.referred_user_id = p_referred_user_id
    and r.status = 'registered'
  for update;

  if v_referral.id is null then
    return jsonb_build_object('status', 'none');
  end if;

  select
    greatest(now(), coalesce(u.referral_bonus_until, now())) + interval '30 days',
    u.chat_id
  into v_referred_until, v_referred_chat_id
  from public.bot_users u
  where u.id = p_referred_user_id
  for update;

  select greatest(now(), coalesce(u.referral_bonus_until, now())) + interval '30 days'
  into v_referrer_until
  from public.bot_users u
  where u.id = v_referral.referrer_user_id
  for update;

  if v_referred_until is null or v_referrer_until is null then
    return jsonb_build_object('status', 'user_not_found');
  end if;

  update public.bot_users
  set referral_bonus_until = v_referred_until,
      referral_bonus_days = referral_bonus_days + 30,
      updated_at = now()
  where id = p_referred_user_id;

  update public.bot_users
  set referral_bonus_until = v_referrer_until,
      referral_bonus_days = referral_bonus_days + 30,
      updated_at = now()
  where id = v_referral.referrer_user_id;

  update public.referrals
  set status = 'rewarded',
      qualified_at = now(),
      rewarded_at = now(),
      premium_granted_until = v_referred_until
  where id = v_referral.id;

  return jsonb_build_object(
    'status', 'rewarded',
    'referral_id', v_referral.id,
    'referrer_user_id', v_referral.referrer_user_id,
    'referred_user_id', p_referred_user_id,
    'referred_chat_id', v_referred_chat_id,
    'referred_premium_until', v_referred_until,
    'referrer_premium_until', v_referrer_until
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.claim_source_jobs(p_worker text, p_qty integer DEFAULT 3)
 RETURNS TABLE(job_id uuid, queue_msg_id bigint, source_id smallint, worker_slug text, attempt integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; v_job uuid; v_source smallint; v_attempt integer; v_status text; v_limit integer:=greatest(1,least(coalesce(p_qty,3),3));
begin
  for r in select * from pgmq.read('source_jobs',600,v_limit,'{}'::jsonb)
  loop
    begin v_job:=(r.message->>'job_id')::uuid; v_source:=(r.message->>'source_id')::smallint;
    exception when others then perform pgmq.archive('source_jobs',r.msg_id); continue; end;
    -- A worker that repeatedly dies must not hold one source forever.
    update public.source_jobs j
    set status='dead', error_message='Source job lease expired after five attempts',
        finished_at=now(), updated_at=now()
    where j.id=v_job and j.queue_msg_id=r.msg_id and j.status='processing'
      and j.attempts>=5 and j.updated_at<=now()-interval '10 minutes';
    if found then
      perform pgmq.archive('source_jobs', r.msg_id);
      continue;
    end if;
    update public.source_jobs j
    set status='processing',attempts=j.attempts+1,started_at=now(),worker='source-worker',updated_at=now()
    where j.id=v_job and j.queue_msg_id=r.msg_id and (j.status in ('enqueued','retry') or (j.status='processing' and j.updated_at <= now()-interval '10 minutes'))
    returning j.attempts into v_attempt;
    if found then
      job_id:=v_job; queue_msg_id:=r.msg_id; source_id:=v_source; worker_slug:='source-worker'; attempt:=v_attempt; return next;
    else
      select j.status into v_status from public.source_jobs j where j.id=v_job and j.queue_msg_id=r.msg_id;
      if v_status is distinct from 'processing' then perform pgmq.archive('source_jobs',r.msg_id); end if;
    end if;
  end loop;
end;$function$;

create or replace function public.finish_source_job_attempt(
  p_job_id uuid,
  p_attempt integer,
  p_success boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  j public.source_jobs%rowtype;
begin
  select * into j from public.source_jobs where id = p_job_id for update;
  if not found or j.attempts is distinct from p_attempt then
    return false;
  end if;
  -- Lost HTTP response after a committed acknowledgement: safe to repeat.
  if j.status = 'done' and p_success then return true; end if;
  if j.status in ('retry', 'dead') and not p_success then return true; end if;
  if j.status <> 'processing' then return false; end if;
  perform public.finish_source_job(p_job_id, p_success, p_error);
  return true;
end;
$function$;

revoke execute on function public.complete_referral_reward(uuid) from public, anon, authenticated;
grant execute on function public.complete_referral_reward(uuid) to service_role;
revoke execute on function public.finish_source_job_attempt(uuid, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.finish_source_job_attempt(uuid, integer, boolean, text) to service_role;
revoke execute on function public.claim_source_jobs(text, integer) from public, anon, authenticated;
grant execute on function public.claim_source_jobs(text, integer) to service_role;
