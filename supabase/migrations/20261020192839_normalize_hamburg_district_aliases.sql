create table if not exists app_private.hamburg_neighborhood_aliases (
  alias text primary key,
  neighborhood_id smallint not null references public.hamburg_neighborhoods(id),
  source text not null default 'manual',
  confidence numeric(4,3) not null default 1.000,
  created_at timestamptz not null default now()
);
alter table app_private.hamburg_neighborhood_aliases enable row level security;
revoke all on table app_private.hamburg_neighborhood_aliases from anon, authenticated, public;
revoke usage on schema app_private from anon, authenticated, public;
drop policy if exists hamburg_neighborhood_aliases_deny_public on app_private.hamburg_neighborhood_aliases;
create policy hamburg_neighborhood_aliases_deny_public on app_private.hamburg_neighborhood_aliases as restrictive for all to anon, authenticated using (false) with check (false);
insert into app_private.hamburg_neighborhood_aliases(alias, neighborhood_id, source, confidence)
select v.alias, n.id, 'manual', 1.000
from (values ('altstadt'),('hamb.-altstadt'),('hamburg altstadt')) v(alias)
join public.hamburg_neighborhoods n on n.name='Hamburg-Altstadt'
on conflict (alias) do update set neighborhood_id=excluded.neighborhood_id, source=excluded.source, confidence=excluded.confidence;
create or replace function public.normalize_hamburg_neighborhood(p_value text)
returns smallint
language sql stable security definer set search_path to ''
as $function$
select coalesce(
 (select n.id from public.hamburg_neighborhoods n where lower(trim(n.name))=lower(trim(p_value)) limit 1),
 (select a.neighborhood_id from app_private.hamburg_neighborhood_aliases a where a.alias=lower(trim(p_value)) limit 1)
);
$function$;
revoke all on function public.normalize_hamburg_neighborhood(text) from public, anon, authenticated;
grant execute on function public.normalize_hamburg_neighborhood(text) to service_role;