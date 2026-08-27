do $$
declare
  v_oid oid;
  v_def text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app_private' and p.proname='refresh_source_field_capabilities';
  select pg_get_functiondef(v_oid) into v_def;
  v_def := replace(v_def,
    'left join public.listings l on l.source_id=s.id',
    'left join public.listings l on l.source_id=s.id and l.quality_status=''accepted''');
  execute v_def;
end $$;
select app_private.refresh_source_field_capabilities();
