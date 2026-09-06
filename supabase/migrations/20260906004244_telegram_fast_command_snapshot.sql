create or replace function public.prepare_telegram_fast_action(p_payload jsonb, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
  v_claim integer;
  v_user jsonb;
  v_subscription jsonb;
  v_user_id uuid;
  v_is_premium boolean := false;
  v_limit integer := 1;
  v_data jsonb := '{}'::jsonb;
  v_slot integer;
  v_profiles jsonb;
  v_saved jsonb;
  v_saved_count integer;
begin
  v_base := public.prepare_telegram_update(p_payload);
  v_claim := coalesce((v_base->>'claim')::integer, 0);
  if v_claim <= 0 then
    return v_base;
  end if;

  v_user := v_base->'user';
  v_subscription := v_base->'subscription';
  v_user_id := (v_user->>'id')::uuid;

  v_is_premium := case
    when v_user->>'plan_override' = 'free' then false
    when v_user->>'plan_override' = 'premium'
      and (nullif(v_user->>'plan_override_expires_at','') is null
           or (v_user->>'plan_override_expires_at')::timestamptz > now()) then true
    when nullif(v_user->>'referral_bonus_until','') is not null
      and (v_user->>'referral_bonus_until')::timestamptz > now() then true
    when v_subscription is not null
      and coalesce(v_subscription->>'status','') in ('active','trialing')
      and (nullif(v_subscription->>'current_period_end','') is null
           or (v_subscription->>'current_period_end')::timestamptz > now()) then true
    else false
  end;
  v_limit := case when v_is_premium then 3 else 1 end;

  if p_action in ('profile','new') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'profile_slot', sp.profile_slot,
      'name', sp.name,
      'is_active', sp.is_active
    ) order by sp.profile_slot), '[]'::jsonb)
    into v_profiles
    from public.search_profiles sp
    where sp.user_id = v_user_id
      and sp.profile_slot <= v_limit;
    v_data := v_data || jsonb_build_object('profiles', v_profiles, 'profile_limit', v_limit);
  end if;

  if p_action = 'new' then
    select s into v_slot
    from generate_series(1, v_limit) s
    where not exists (
      select 1 from public.search_profiles sp
      where sp.user_id = v_user_id and sp.profile_slot = s
    )
    order by s
    limit 1;

    if v_slot is not null then
      update public.bot_users
      set onboarding_step = 'types',
          onboarding_state = jsonb_build_object(
            'profile_slot', v_slot,
            'property_types', jsonb_build_array(),
            'location_mode', null,
            'borough_ids', jsonb_build_array(),
            'neighborhood_ids', jsonb_build_array(),
            'neighborhood_page', 0,
            'max_warm_rent', null,
            'min_rooms', null,
            'min_area_sqm', null
          ),
          updated_at = now()
      where id = v_user_id;
      v_data := v_data || jsonb_build_object('new_slot', v_slot);
    else
      v_data := v_data || jsonb_build_object('new_slot', null);
    end if;
  elsif p_action in ('pause','resume') then
    update public.search_profiles
    set is_active = (p_action = 'resume'), updated_at = now()
    where user_id = v_user_id;
    v_data := v_data || jsonb_build_object('paused', p_action = 'pause');
  elsif p_action = 'status' then
    v_data := v_data || jsonb_build_object(
      'profile_limit', v_limit,
      'active_profiles', (select count(*) from public.search_profiles sp where sp.user_id = v_user_id and sp.is_active = true and sp.profile_slot <= v_limit),
      'source_count', (select count(*) from public.sources),
      'referral_count', (select count(*) from public.referrals r where r.referrer_user_id = v_user_id and r.status = 'rewarded')
    );
  elsif p_action = 'saved' and v_is_premium then
    select count(*) into v_saved_count from public.saved_listings sl where sl.user_id = v_user_id;
    select coalesce(jsonb_agg(x.row_data order by x.created_at desc), '[]'::jsonb)
    into v_saved
    from (
      select sl.created_at,
             jsonb_build_object(
               'listing_id', sl.listing_id,
               'created_at', sl.created_at,
               'listing', jsonb_build_object(
                 'title', l.title,
                 'canonical_url', l.canonical_url,
                 'is_active', l.is_active
               )
             ) as row_data
      from public.saved_listings sl
      join public.listings l on l.id = sl.listing_id
      where sl.user_id = v_user_id
      order by sl.created_at desc
      limit 8
    ) x;
    v_data := v_data || jsonb_build_object('saved_count', v_saved_count, 'saved', v_saved);
  end if;

  return v_base || jsonb_build_object(
    'is_premium', v_is_premium,
    'action_data', v_data
  );
end;
$$;

revoke all on function public.prepare_telegram_fast_action(jsonb,text) from public, anon, authenticated;
grant execute on function public.prepare_telegram_fast_action(jsonb,text) to service_role;