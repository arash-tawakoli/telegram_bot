do $block$
begin
  if exists (select 1 from cron.job where jobname='billing-maintenance-daily') then
    update cron.job
    set schedule='22 4 * * *',
        command=$cmd$
          select net.http_post(
            url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/billing-maintenance',
            headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
            body:='{}'::jsonb,
            timeout_milliseconds:=45000
          );
        $cmd$,
        active=true
    where jobname='billing-maintenance-daily';
  else
    perform cron.schedule(
      'billing-maintenance-daily',
      '22 4 * * *',
      $cmd$
        select net.http_post(
          url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/billing-maintenance',
          headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
          body:='{}'::jsonb,
          timeout_milliseconds:=45000
        );
      $cmd$
    );
  end if;
end;
$block$;
