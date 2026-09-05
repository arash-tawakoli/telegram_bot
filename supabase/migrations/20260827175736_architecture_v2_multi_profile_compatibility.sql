drop index if exists public.search_profiles_one_active_per_user_uidx;

-- Restore profiles that were deactivated only by architecture_v2_observability_and_availability.
update public.search_profiles
set is_active=true,updated_at=now()
where is_active=false
  and updated_at='2026-08-27 17:53:48.743896+00'::timestamptz;

-- Multiple active profiles remain supported; recipient-level outbox uniqueness prevents duplicate Telegram sends.;
