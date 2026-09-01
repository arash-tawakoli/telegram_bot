-- Transitional PostgREST computed field for the deployed dispatcher query.
-- It carries no partner data and always returns NULL. Remove after the dispatcher
-- bundle no longer selects the removed household_id column.

create or replace function public.household_id(public.search_profiles)
returns uuid
language sql
immutable
parallel safe
set search_path = ''
as $$
  select null::uuid;
$$;

revoke all on function public.household_id(public.search_profiles) from public;
grant execute on function public.household_id(public.search_profiles) to service_role;

notify pgrst, 'reload schema';
