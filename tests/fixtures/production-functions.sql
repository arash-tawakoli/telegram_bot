-- Function definitions inspected in production on 2026-09-05; no user data.
CREATE OR REPLACE FUNCTION public.claim_source_jobs(p_worker text, p_qty integer DEFAULT 3)
 RETURNS TABLE(job_id uuid, queue_msg_id bigint, source_id smallint, worker_slug text, attempt integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; v_job uuid; v_source smallint; v_attempt integer; v_status text; v_limit integer:=greatest(1,least(coalesce(p_qty,3),3));
begin
  for r in select * from pgmq.read('source_jobs',120,v_limit,'{}'::jsonb)
  loop
    begin v_job:=(r.message->>'job_id')::uuid; v_source:=(r.message->>'source_id')::smallint;
    exception when others then perform pgmq.archive('source_jobs',r.msg_id); continue; end;
    update public.source_jobs j
    set status='processing',attempts=j.attempts+1,started_at=coalesce(j.started_at,now()),worker='source-worker',updated_at=now()
    where j.id=v_job and j.queue_msg_id=r.msg_id and j.status in ('enqueued','retry')
    returning j.attempts into v_attempt;
    if found then
      job_id:=v_job; queue_msg_id:=r.msg_id; source_id:=v_source; worker_slug:='source-worker'; attempt:=v_attempt; return next;
    else
      select j.status into v_status from public.source_jobs j where j.id=v_job and j.queue_msg_id=r.msg_id;
      if v_status is distinct from 'processing' then perform pgmq.archive('source_jobs',r.msg_id); end if;
    end if;
  end loop;
end;$function$;

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

CREATE OR REPLACE FUNCTION public.finish_source_job(p_job_id uuid, p_success boolean, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.source_jobs%rowtype; v_delay integer;
begin
  select * into j from public.source_jobs where id=p_job_id for update;
  if not found then return false; end if;

  if p_success then
    perform pgmq.archive('source_jobs',j.queue_msg_id);
    update public.source_jobs set status='done',error_message=null,finished_at=now(),updated_at=now() where id=p_job_id;
    return true;
  end if;

  if j.attempts>=5 then
    perform pgmq.archive('source_jobs',j.queue_msg_id);
    update public.source_jobs set status='dead',error_message=left(coalesce(p_error,'worker failed'),1500),finished_at=now(),updated_at=now() where id=p_job_id;
    return false;
  end if;

  v_delay:=case when j.attempts<=1 then 60 when j.attempts=2 then 300 else 900 end;
  perform * from pgmq.set_vt('source_jobs',j.queue_msg_id,v_delay);
  update public.source_jobs set status='retry',error_message=left(coalesce(p_error,'worker failed'),1500),updated_at=now() where id=p_job_id;
  return false;
end;
$function$;
