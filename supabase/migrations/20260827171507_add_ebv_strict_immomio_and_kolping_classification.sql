-- EBV Harburg exposes a confirmed public Immomio homepage property module.
update public.source_connectors
set connector_kind='immomio_tenant', label='Immomio Tenant GraphQL',
    config=jsonb_build_object('url','https://homepage.immomio.com/de/properties?token=eyJhbGciOiJIUzI1NiJ9.eyJjdXN0b21lcklkIjo0MTI2OTU4ODksImlkIjo0MTUyMTk5NDksImNyZWF0ZWQiOjE2ODEzNjczODQ4NzN9.QtXsJ1XCg3IcjMjJr8lqPkPbJy9Dd3dswH11AitJsow'), enabled=true
where source_id=32 and priority=1;
update public.source_connectors set enabled=false where source_id=32 and priority<>1;

-- KOLPING is a Baugenossenschaft and belongs in the cooperative coverage audit.
update public.sources set source_type='Baugenossenschaft', updated_at=now() where id=53;
