-- Security/performance hardening from Supabase database advisors.

-- Event-trigger helper must not be exposed as an RPC to public API roles.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Cover the delivery_events -> listings foreign key.
create index if not exists delivery_events_listing_idx
  on public.delivery_events(listing_id);
