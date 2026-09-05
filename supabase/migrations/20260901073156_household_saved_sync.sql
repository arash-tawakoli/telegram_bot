create or replace function app_private.enforce_household_member_limit()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_owner uuid;
  v_count integer;
begin
  select h.owner_user_id into v_owner
  from public.households h
  where h.id=new.household_id
  for update;

  if v_owner is null then raise exception 'household not found'; end if;
  if new.role='owner' and new.user_id<>v_owner then
    raise exception 'household owner mismatch';
  end if;
  if new.role='member' and not app_private.user_is_premium(v_owner) then
    raise exception 'household owner premium required';
  end if;

  select count(*) into v_count
  from public.household_members hm
  where hm.household_id=new.household_id;
  if v_count>=2 then raise exception 'household member limit reached'; end if;
  return new;
end;
$function$;

create or replace function app_private.sync_household_saved_listing()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_row public.saved_listings%rowtype;
begin
  if pg_trigger_depth()>1 then
    return case when tg_op='DELETE' then old else new end;
  end if;

  if tg_op='DELETE' then
    if old.household_id is not null then
      delete from public.saved_listings s
      where s.household_id=old.household_id
        and s.listing_id=old.listing_id
        and s.id<>old.id;
    end if;
    return old;
  end if;

  v_row:=new;
  if v_row.household_id is null then return new; end if;

  insert into public.saved_listings(user_id,listing_id,status,note,household_id,updated_at)
  select hm.user_id,v_row.listing_id,v_row.status,v_row.note,v_row.household_id,now()
  from public.household_members hm
  where hm.household_id=v_row.household_id
  on conflict(user_id,listing_id) do update
  set household_id=excluded.household_id,
      status=excluded.status,
      note=excluded.note,
      updated_at=now();

  update public.saved_listings s
  set status=v_row.status,
      note=v_row.note,
      household_id=v_row.household_id,
      updated_at=now()
  where s.household_id=v_row.household_id
    and s.listing_id=v_row.listing_id
    and s.id<>v_row.id
    and (s.status,s.note,s.household_id) is distinct from
        (v_row.status,v_row.note,v_row.household_id);
  return new;
end;
$function$;

drop trigger if exists saved_listings_sync_household on public.saved_listings;
create trigger saved_listings_sync_household
after insert or update of household_id,status,note or delete on public.saved_listings
for each row execute function app_private.sync_household_saved_listing();

create or replace function app_private.initialize_household_member_data()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_owner uuid;
begin
  if new.role<>'member' then return new; end if;
  select h.owner_user_id into v_owner
  from public.households h
  where h.id=new.household_id;

  update public.search_profiles p
  set household_id=new.household_id,
      updated_at=now()
  where p.user_id=v_owner;

  update public.saved_listings s
  set household_id=new.household_id,
      updated_at=now()
  where s.user_id=v_owner
    and s.household_id is null;
  return new;
end;
$function$;

drop trigger if exists household_members_initialize_data on public.household_members;
create trigger household_members_initialize_data
after insert on public.household_members
for each row execute function app_private.initialize_household_member_data();

create or replace function app_private.cleanup_household_member_data()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.role='member' then
    delete from public.saved_listings s
    where s.user_id=old.user_id
      and s.household_id=old.household_id;
    update public.search_profiles p
    set household_id=null,
        updated_at=now()
    where p.user_id=old.user_id
      and p.household_id=old.household_id;
  end if;
  return old;
end;
$function$;

drop trigger if exists household_members_cleanup_data on public.household_members;
create trigger household_members_cleanup_data
after delete on public.household_members
for each row execute function app_private.cleanup_household_member_data();
