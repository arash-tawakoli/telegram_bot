export async function waitForDispatchSlot(db: any, owner: string, deadline: number, clock = Date.now, sleep = (ms: number) => new Promise(r => setTimeout(r, ms))) {
  const {data,error} = await db.rpc('dispatcher_slot',{p_owner:owner});
  if(error) throw error;
  const at = new Date(data).getTime();
  if(!Number.isFinite(at)) throw new Error('Invalid dispatcher slot');
  if(at>=deadline) return false;
  const wait=Math.max(0,at-clock());
  if(wait) await sleep(wait);
  return clock()<deadline;
}
