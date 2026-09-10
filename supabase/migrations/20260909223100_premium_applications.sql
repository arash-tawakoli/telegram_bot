-- Backend-only automatic application tables.
alter table public.bot_users
  add column auto_apply_enabled boolean not null default false;

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.bot_users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete restrict,
  source_id bigint not null references public.sources(id),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','manual_required')),
  application_text text,
  attempts integer not null default 0 check (attempts>=0),
  last_error text,
  submission_started_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id,listing_id)
);
create index applications_listing_idx on public.applications(listing_id);
create index applications_source_idx on public.applications(source_id);
alter table public.applications enable row level security;
revoke all on public.applications from public,anon,authenticated;
grant select,insert,update on public.applications to service_role;

-- No platform is enabled until an authenticated submission test is verified.
create table app_private.application_platforms (
  source_id bigint primary key references public.sources(id),
  verified_at timestamptz
);
alter table app_private.application_platforms enable row level security;
revoke all on app_private.application_platforms from public,anon,authenticated;

create function app_private.guard_application_opt_in() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.auto_apply_enabled and (tg_op='INSERT' or not old.auto_apply_enabled) then
    if not app_private.user_is_premium(new.id) or not new.is_active
      or not exists(select 1 from app_private.application_platforms where verified_at is not null)
    then raise exception 'automatic applications are not available'; end if;
  end if;
  return new;
end $$;
create trigger guard_application_opt_in before insert or update of auto_apply_enabled on public.bot_users
for each row execute function app_private.guard_application_opt_in();

-- Lease acquisition and remote-send authorization are separate. No automatic
-- retry may cross the durable submission_started_at checkpoint.
create function public.begin_application_submission(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare a public.applications%rowtype;
begin
  select * into a from public.applications where id=p_id for update;
  if not found or a.status<>'pending' or a.submission_started_at is not null then return false; end if;
  if not exists(
    select 1 from public.bot_users u join public.listings l on l.id=a.listing_id
    join app_private.application_platforms p on p.source_id=l.source_id and p.verified_at is not null
    where u.id=a.user_id and u.is_active and u.auto_apply_enabled
      and app_private.user_is_premium(u.id) and l.is_active and l.source_id=a.source_id
      and app_private.current_listing_is_delivery_fresh(l.source_id,l.raw,l.fresh_delivery_eligible)
      and exists(select 1 from public.delivery_events d where d.listing_id=l.id and d.recipient_user_id=u.id)
  ) then
    update public.applications set status='failed',last_error='not_eligible' where id=p_id;
    return false;
  end if;
  update public.applications set status='processing',attempts=attempts+1,submission_started_at=now() where id=p_id;
  return true;
end $$;
revoke all on function public.begin_application_submission(uuid) from public,anon,authenticated;
grant execute on function public.begin_application_submission(uuid) to service_role;
revoke all on function app_private.guard_application_opt_in() from public,anon,authenticated;
;

