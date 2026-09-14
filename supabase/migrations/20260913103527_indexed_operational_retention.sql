-- BRIN ranges overlap after heap reuse and scan most retained history.
-- Equality on outcome followed by expiry keeps each retention window selective.
SET lock_timeout = '3s';
CREATE INDEX source_jobs_retention_idx ON public.source_jobs (status, finished_at)
  WHERE status IN ('done','dead');
CREATE INDEX crawl_runs_retention_idx ON public.crawl_runs (success, finished_at)
  WHERE finished_at IS NOT NULL;
CREATE INDEX crawl_runs_successful_connector_idx ON public.crawl_runs
  (source_id, connector_priority, connector_label) WHERE success = true;
DROP INDEX public.source_jobs_retention_brin;
DROP INDEX public.crawl_runs_retention_brin;
