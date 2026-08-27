-- Production migration history reconciliation.
-- Confirmed Immomio public property modules use the strict tenant connector.
update public.source_connectors sc
set connector_kind='immomio_tenant',
    label='Immomio Tenant GraphQL',
    config=jsonb_build_object('url',v.url),
    enabled=true
from (values
 (23,'https://homepage.immomio.com/de/properties?token=eyJhbGciOiJIUzI1NiJ9.eyJjdXN0b21lcklkIjoxNDI3MzI5MjksImlkIjoxODcwMDEzMjAsImNyZWF0ZWQiOjE2NTc0NzYyMzg4Nzl9.C1vwdfjJ27h7-HWIvGKBrsgWGcj-8-ArzkiOKoBpSgs'),
 (28,'https://homepage.immomio.com/de/properties?token=eyJhbGciOiJIUzI1NiJ9.eyJjdXN0b21lcklkIjoxNTY2MDQwMzUsImlkIjoxNzA2MDA0NjIsImNyZWF0ZWQiOjE2NDIxNjYwNDY2Mzh9.1QlkdnxWyyJMcRS1JubN1EkDrHPRaqfASe6oUJq7ptU'),
 (29,'https://homepage.immomio.com/de/properties?token=eyJhbGciOiJIUzI1NiJ9.eyJjdXN0b21lcklkIjoyNTQxMzQ1MDYsImlkIjoyNzI4MDEwODUsImNyZWF0ZWQiOjE2NjE5NDY5ODY1MDF9.fo3dJ4iNYF825tbg1E5C6q0mXbtbePO1LO3S_3_SEhM'),
 (30,'https://homepage.immomio.com/de/properties?token=eyJhbGciOiJIUzI1NiJ9.eyJjdXN0b21lcklkIjoxMzUyOTQ4NDQyLCJpZCI6MTM1OTk3ODYyMiwiY3JlYXRlZCI6MTc0MTg1MjU5MzY3MX0.pChDZy6PY9lv2432Q5q9oib6Wu67woeKIdBS_g-Kiyw'),
 (34,'https://homepage.immomio.com/de/properties?token=eyJhbGciOiJIUzI1NiJ9.eyJjdXN0b21lcklkIjoxMzI0NDk5MDE3LCJjcmVhdGVkIjoxNzUyNzM0NDc5NDE4LCJpZCI6MTQ4NzA4NDQ2M30.9Em7vOpMbX_dUfUiYZvvitn_WTWuNJQIb7ORk73k-YQ'),
 (36,'https://homepage.immomio.com/de/properties?token=eyJhbGciOiJIUzI1NiJ9.eyJjdXN0b21lcklkIjo1MDU5NzAxNTcsImlkIjo1MTU3NjcwMjksImNyZWF0ZWQiOjE2OTMzODA5OTU0OTN9.v7hxx-fs_yS5N2n57Aj47nj7_GBDOfH9AzXHLlKj5gk'),
 (39,'https://homepage.immomio.com/de/properties?token=eyJhbGciOiJIUzI1NiJ9.eyJjdXN0b21lcklkIjo0MDU3Nzk0NCwiaWQiOjU5MzA1MjYzNCwiY3JlYXRlZCI6MTcwNjE5NjI0MDYxNH0.nvPLRZVb4Y492PDuJo4b7JYB0d0xTCZSsRUHQulQrGo'),
 (65,'https://homepage.immomio.com/de/properties?token=eyJhbGciOiJIUzI1NiJ9.eyJjdXN0b21lcklkIjoyODYxOTA4ODMsImlkIjoyOTIxMTgyMzgsImNyZWF0ZWQiOjE2NjY1OTQ0NzE5OTJ9.l-IorHm_QkfJf7tidzsCoW9x9xeIk01uO8BbuzmJ6Bg')
) as v(source_id,url)
where sc.source_id=v.source_id and sc.priority=1;

update public.source_connectors
set enabled=false
where source_id in (23,28,29,30,34,36,39,65) and priority<>1;

delete from public.listings
where source_id in (23,28,29,30,34,36,39,65)
  and canonical_url not like 'https://tenant.immomio.com/apply/%';
