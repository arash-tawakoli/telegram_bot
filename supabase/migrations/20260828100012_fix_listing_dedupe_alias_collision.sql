-- Production reconciliation marker.
-- The production hotfix replaced the ambiguous local record alias `g` with `v_merge`
-- inside app_private.reconcile_listing_duplicates(). The reconstructed 20260828094408
-- migration already contains that corrected definition so a clean bootstrap never
-- installs the known-bad intermediate function.

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname = 'reconcile_listing_duplicates'
      and pg_get_functiondef(p.oid) like '%v_merge record%'
  ) then
    raise exception 'reconcile_listing_duplicates must contain the v_merge alias fix';
  end if;
end;
$$;
