-- EBV Harburg exposes a confirmed public Immomio homepage module with a property-list token.
update public.source_connectors
set connector_kind='immomio_tenant', label='Immomio Tenant GraphQL',
    config=jsonb_build_object('url',replace('https://homepage.immomio.com/de/properties?token=VAULT_migration_credential_fad3b69247f06fda791a','VAULT_migration_credential_fad3b69247f06fda791a',public.get_bot_secret('migration_credential_fad3b69247f06fda791a'))), enabled=true
where source_id=32 and priority=1;
update public.source_connectors set enabled=false where source_id=32 and priority<>1;

-- KOLPING is a Baugenossenschaft and belongs in the cooperative coverage audit.
update public.sources set source_type='Baugenossenschaft', updated_at=now() where id=53;

-- Route every confirmed public Immomio property-list source through the strict worker.
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
 url:=case when claimed.id=1 then 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-immoscout' when claimed.id=2 then 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-kleinanzeigen' when claimed.id=3 then 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-immowelt' when claimed.id in (23,28,29,30,32,34,36,39,65) then 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-immomio' else 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-engine' end,
 headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
 body:=jsonb_build_object('source_id',claimed.id),timeout_milliseconds:=15000)
from claimed;
$$);
