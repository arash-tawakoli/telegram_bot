-- Official public search API, exposed by Nestpick's own search frontend.
begin;
update public.source_connectors
set label='Nestpick public paginated inventory',connector_kind='json_endpoint',enumerable=false,
 config=jsonb_build_object('adapter','source-worker/nestpick-public','url','https://www.nestpick.com/search/api/?city=hamburg&location=101748841&currency=EUR&order=relevance','freshness_mode','native_new')
where source_id=19 and priority=1;
update public.source_connectors set shadow_only=true where source_id=19 and priority>1;
commit;
