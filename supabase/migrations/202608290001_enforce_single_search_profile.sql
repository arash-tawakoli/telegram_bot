-- Enforce exactly one search profile slot per bot user.
-- Existing duplicate profiles were cleaned before this migration was applied in production.
create unique index if not exists search_profiles_one_per_user_idx
  on public.search_profiles (user_id);
