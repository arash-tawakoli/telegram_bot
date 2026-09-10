-- Backend-only tables: Telegram users are not Supabase Auth users.
alter table public.bot_users
  add column applicant_profile jsonb not null default '{}'::jsonb,
  add column auto_apply_enabled boolean not null default false;
alter table public.bot_users add constraint applicant_profile_object
  check (jsonb_typeof(applicant_profile)='object' and octet_length(applicant_profile::text)<=12000);

create table public.application_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.bot_users(id) on delete restrict,
  kind text not null check (kind in ('wbs','schufa','rent_clearance','guarantee','income','other')),
  telegram_message_id bigint not null,
  filename text not null check (length(filename) between 1 and 120),
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  bytes integer not null check (bytes between 1 and 5242880),
  ready boolean not null default false,
  share_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id,telegram_message_id),
  check (not share_enabled or ready)
);
alter table public.application_documents enable row level security;
revoke all on public.application_documents from public,anon,authenticated;
grant select,insert,update,delete on public.application_documents to service_role;

create function app_private.guard_applicant_write() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_table_name='bot_users' then
    if new.applicant_profile is distinct from old.applicant_profile and new.applicant_profile<>'{}'::jsonb
      and (not new.is_active or not app_private.user_is_premium(new.id)) then
      raise exception 'premium required';
    end if;
  else
    perform 1 from public.bot_users where id=new.user_id for update;
    if tg_op='UPDATE' then
      if new.user_id<>old.user_id or new.telegram_message_id<>old.telegram_message_id then raise exception 'immutable owner'; end if;
      if not new.share_enabled and (to_jsonb(new)-'share_enabled')=(to_jsonb(old)-'share_enabled') then return new; end if;
    end if;
    if not exists(select 1 from public.bot_users where id=new.user_id and is_active)
      or not app_private.user_is_premium(new.user_id) then raise exception 'premium required'; end if;
    if tg_op='INSERT' and not exists(select 1 from public.application_documents where user_id=new.user_id and telegram_message_id=new.telegram_message_id)
      and (select count(*) from public.application_documents where user_id=new.user_id)>=20 then
      raise exception 'maximum 20 documents';
    end if;
  end if;
  return new;
end $$;
create trigger guard_applicant_profile before update of applicant_profile on public.bot_users
for each row execute function app_private.guard_applicant_write();
create trigger guard_applicant_document before insert or update on public.application_documents
for each row execute function app_private.guard_applicant_write();
revoke all on function app_private.guard_applicant_write() from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('application-documents','application-documents',false,5242880,
  array['application/pdf','image/jpeg','image/png']);

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

