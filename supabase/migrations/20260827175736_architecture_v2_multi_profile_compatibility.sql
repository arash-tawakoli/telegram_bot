-- Multiple active search profiles remain supported by the existing Telegram UI.
-- Recipient-level outbox uniqueness prevents duplicate Telegram sends.
drop index if exists public.search_profiles_one_active_per_user_uidx;
