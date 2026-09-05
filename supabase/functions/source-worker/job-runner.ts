export type SourceJob = { job_id: string; source_id: number; attempt: number };
type FinishArgs = {
  p_job_id: string;
  p_attempt: number;
  p_success: boolean;
  p_error: string | null;
};

// A failed acknowledgement is not a failed crawl. Do not call finish twice:
// the first RPC may have committed before its HTTP response was lost.
export async function runClaimedJob(
  job: SourceJob,
  process: (sourceId: number) => Promise<any>,
  finish: (args: FinishArgs) => Promise<boolean>,
) {
  let result: any;
  try {
    result = await process(Number(job.source_id));
  } catch (error) {
    result = {
      ok: false,
      source_id: job.source_id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const success = result?.ok !== false;
  const accepted = await finish({
    p_job_id: job.job_id,
    p_attempt: job.attempt,
    p_success: success,
    p_error: success ? null : JSON.stringify(result).slice(0, 1200),
  });
  if (!accepted)
    throw new Error(`Source job ${job.job_id}: lease no longer owned`);
  return result;
}
