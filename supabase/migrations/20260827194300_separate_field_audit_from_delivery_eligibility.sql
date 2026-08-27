do $$
declare v text;
begin
  select pg_get_functiondef(p.oid) into v
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app_private' and p.proname='refresh_source_field_capabilities';
  v:=replace(v,
    'left join public.listings l on l.source_id=s.id and l.enrichment_delivery_eligible=true and l.quality_status<>''rejected''',
    'left join public.listings l on l.source_id=s.id and l.quality_status<>''rejected''');
  execute v;
end $$;
select app_private.refresh_source_field_capabilities();
select app_private.refresh_source_field_audit_status();
