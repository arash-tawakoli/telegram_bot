begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.enqueue_application_now(p_user uuid,p_listing uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare result_id uuid;
begin
  if p_user is null or p_listing is null then return null; end if;
  if not exists(
    select 1
    from public.bot_users u
    join public.listings l on l.id=p_listing
    join app_private.application_platforms ap on ap.source_id=l.source_id and ap.verified_at is not null
    where u.id=p_user
      and u.is_active
      and app_private.user_is_premium(u.id)
      and app_private.applicant_profile_complete(u.id)
      and l.is_active
      and app_private.current_listing_is_delivery_fresh(l.source_id,l.raw,l.fresh_delivery_eligible)
      and exists(select 1 from public.delivery_events d where d.listing_id=l.id and d.recipient_user_id=u.id)
  ) then return null; end if;

  insert into public.applications(user_id,listing_id,source_id)
  select p_user,l.id,l.source_id from public.listings l where l.id=p_listing
  on conflict(user_id,listing_id) do nothing
  returning id into result_id;

  if result_id is null then
    select id into result_id from public.applications where user_id=p_user and listing_id=p_listing;
  end if;
  return result_id;
end $$;
revoke all on function public.enqueue_application_now(uuid,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_application_now(uuid,uuid) to service_role;

create or replace function app_private.guard_application_opt_in() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.auto_apply_enabled and (tg_op='INSERT' or not old.auto_apply_enabled) then
    if not new.is_active
       or not app_private.user_is_premium(new.id)
       or not app_private.applicant_profile_complete(new.id)
       or not exists(select 1 from app_private.application_platforms where verified_at is not null)
    then raise exception 'automatic applications are not available'; end if;
  end if;
  return new;
end $$;
revoke all on function app_private.guard_application_opt_in() from public,anon,authenticated;

commit;
