begin;

create policy telegram_link_tokens_deny_client_access
  on app_private.telegram_link_tokens
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy coach_bootstrap_tokens_deny_client_access
  on app_private.coach_bootstrap_tokens
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy coaching_super_admin_allowlist_deny_client_access
  on app_private.coaching_super_admin_allowlist
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

commit;
