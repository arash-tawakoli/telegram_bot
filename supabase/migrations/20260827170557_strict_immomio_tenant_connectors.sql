-- Convert confirmed Immomio homepage integrations to a strict tenant connector.
-- The URL is the public Immomio homepage token URL; the worker queries gql-hp and
-- accepts only FLAT/RENT nodes whose applicationLink is tenant.immomio.com/apply/<uuid>.
update public.source_connectors sc
set connector_kind='immomio_tenant',
    label='Immomio Tenant GraphQL',
    config=jsonb_build_object('url',v.url),
    enabled=true
from (values
 (23,replace('https://homepage.immomio.com/de/properties?token=VAULT_migration_credential_c7d54fba0da11076f336','VAULT_migration_credential_c7d54fba0da11076f336',public.get_bot_secret('migration_credential_c7d54fba0da11076f336'))),
 (28,replace('https://homepage.immomio.com/de/properties?token=VAULT_migration_credential_c9800d9a30fac051dd98','VAULT_migration_credential_c9800d9a30fac051dd98',public.get_bot_secret('migration_credential_c9800d9a30fac051dd98'))),
 (29,replace('https://homepage.immomio.com/de/properties?token=VAULT_migration_credential_ec7d00186e280818efc1','VAULT_migration_credential_ec7d00186e280818efc1',public.get_bot_secret('migration_credential_ec7d00186e280818efc1'))),
 (30,replace('https://homepage.immomio.com/de/properties?token=VAULT_migration_credential_03fe3e19f62f1ae4bbec','VAULT_migration_credential_03fe3e19f62f1ae4bbec',public.get_bot_secret('migration_credential_03fe3e19f62f1ae4bbec'))),
 (34,replace('https://homepage.immomio.com/de/properties?token=VAULT_migration_credential_4ffd9466ff967d143d56','VAULT_migration_credential_4ffd9466ff967d143d56',public.get_bot_secret('migration_credential_4ffd9466ff967d143d56'))),
 (36,replace('https://homepage.immomio.com/de/properties?token=VAULT_migration_credential_3f7362970c2fc57c14f3','VAULT_migration_credential_3f7362970c2fc57c14f3',public.get_bot_secret('migration_credential_3f7362970c2fc57c14f3'))),
 (39,replace('https://homepage.immomio.com/de/properties?token=VAULT_migration_credential_e7851de35c727bb6cc25','VAULT_migration_credential_e7851de35c727bb6cc25',public.get_bot_secret('migration_credential_e7851de35c727bb6cc25'))),
 (65,replace('https://homepage.immomio.com/de/properties?token=VAULT_migration_credential_5db45f73e77acfd405f2','VAULT_migration_credential_5db45f73e77acfd405f2',public.get_bot_secret('migration_credential_5db45f73e77acfd405f2')))
) as v(source_id,url)
where sc.source_id=v.source_id and sc.priority=1;

-- Do not let generic fallbacks create navigation/privacy/map pseudo listings for
-- sources that have a confirmed Immomio tenant integration.
update public.source_connectors
set enabled=false
where source_id in (23,28,29,30,34,36,39,65) and priority<>1;

-- Remove previously misclassified pseudo listings for confirmed Immomio sources.
-- Real Immomio tenant listings will be reinserted by source-immomio.
delete from public.listings
where source_id in (23,28,29,30,34,36,39,65)
  and canonical_url not like 'https://tenant.immomio.com/apply/%';

-- Route strict Immomio sources to their dedicated worker.
select cron.unschedule('source-engine-every-minute');
select cron.schedule('source-engine-every-minute','* * * * *',$$
with due as (
 select id from public.sources
 where enabled=true and (last_checked_at is null or last_checked_at <= now()-make_interval(mins=>case when coalesce(consecutive_failures,0)>=5 then greatest(poll_interval_minutes,60) when coalesce(consecutive_failures,0)>=3 then greatest(poll_interval_minutes,45) when coalesce(consecutive_failures,0)>=1 then greatest(poll_interval_minutes,30) else poll_interval_minutes end))
 order by coalesce(last_checked_at,'-infinity'::timestamptz),id limit 4 for update skip locked
), claimed as (
 update public.sources s set last_checked_at=now(),updated_at=now() from due where s.id=due.id returning s.id
)
select net.http_post(
 url:=case when claimed.id=1 then 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-immoscout' when claimed.id=2 then 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-kleinanzeigen' when claimed.id=3 then 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-immowelt' when claimed.id in (23,28,29,30,34,36,39,65) then 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-immomio' else 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-engine' end,
 headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
 body:=jsonb_build_object('source_id',claimed.id),timeout_milliseconds:=15000)
from claimed;
$$);
