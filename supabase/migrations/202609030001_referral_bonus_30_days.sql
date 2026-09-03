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
  v_referral_id uuid;
  v_premium_until timestamptz;
begin
  if p_referred_user_id is null or nullif(trim(p_code), '') is null then
    return jsonb_build_object('status', 'invalid_code');
  end if;

  select rc.user_id into v_referrer_user_id
  from public.referral_codes rc
  where lower(rc.code) = lower(trim(p_code))
  limit 1;

  if v_referrer_user_id is null then
    return jsonb_build_object('status', 'invalid_code');
  end if;
  if v_referrer_user_id = p_referred_user_id then
    return jsonb_build_object('status', 'self_referral');
  end if;

  select r.id, r.premium_granted_until into v_referral_id, v_premium_until
  from public.referrals r
  where r.referred_user_id = p_referred_user_id
  limit 1;

  if v_referral_id is not null then
    return jsonb_build_object('status', 'already_redeemed', 'premium_until', v_premium_until);
  end if;

  select greatest(now(), coalesce(u.referral_bonus_until, now())) + interval '30 days'
    into v_premium_until
  from public.bot_users u
  where u.id = p_referred_user_id
  for update;

  if v_premium_until is null then
    return jsonb_build_object('status', 'user_not_found');
  end if;

  insert into public.referrals(
    referrer_user_id,
    referred_user_id,
    status,
    qualified_at,
    rewarded_at,
    premium_granted_until
  ) values (
    v_referrer_user_id,
    p_referred_user_id,
    'rewarded',
    now(),
    now(),
    v_premium_until
  )
  on conflict (referred_user_id) do nothing
  returning id into v_referral_id;

  if v_referral_id is null then
    select r.premium_granted_until into v_premium_until
    from public.referrals r
    where r.referred_user_id = p_referred_user_id;
    return jsonb_build_object('status', 'already_redeemed', 'premium_until', v_premium_until);
  end if;

  update public.bot_users
  set referral_bonus_until = v_premium_until,
      referral_bonus_days = referral_bonus_days + 30,
      updated_at = now()
  where id = p_referred_user_id;

  return jsonb_build_object(
    'status', 'granted',
    'premium_until', v_premium_until,
    'referrer_user_id', v_referrer_user_id
  );
end
$$;
