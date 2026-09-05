create or replace function public.redeem_referral_code(
  p_referred_user_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referrer_user_id uuid;
  v_existing public.referrals%rowtype;
begin
  if p_referred_user_id is null or nullif(trim(p_code), '') is null then
    return jsonb_build_object('status', 'invalid_code');
  end if;

  select rc.user_id into v_referrer_user_id
  from public.referral_codes rc
  where lower(rc.code) = lower(trim(p_code))
    and rc.active = true
  limit 1;

  if v_referrer_user_id is null then
    return jsonb_build_object('status', 'invalid_code');
  end if;
  if v_referrer_user_id = p_referred_user_id then
    return jsonb_build_object('status', 'self_referral');
  end if;

  select * into v_existing
  from public.referrals r
  where r.referred_user_id = p_referred_user_id
  limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('status', 'already_registered');
  end if;

  if exists (
    select 1 from public.search_profiles sp
    where sp.user_id = p_referred_user_id
  ) then
    return jsonb_build_object('status', 'not_new_user');
  end if;

  insert into public.referrals(
    referrer_user_id,
    referred_user_id,
    status
  ) values (
    v_referrer_user_id,
    p_referred_user_id,
    'registered'
  );

  return jsonb_build_object(
    'status', 'registered',
    'referrer_user_id', v_referrer_user_id
  );
end
$$;

create or replace function public.complete_referral_reward(
  p_referred_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;
