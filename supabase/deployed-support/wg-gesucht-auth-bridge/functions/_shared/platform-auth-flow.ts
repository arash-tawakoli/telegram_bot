// Keep provider calls outside SQL; reserve and persist their successful result once.
export async function claimPlatformConnectFlow(db:any,flow:any){
 const {data,error}=await db.rpc('claim_platform_connect_flow',{
  p_flow:flow.id,p_user:flow.user_id,p_provider:flow.provider
 });
 if(error||typeof data!=='string'||!data)throw Error(error?.message||'auth_flow_expired');
 flow.completionClaim=data;
 return data;
}
export async function completePlatformConnectFlow(db:any,flow:any,connection:any){
 if(!flow.completionClaim)await claimPlatformConnectFlow(db,flow);
 const {data,error}=await db.rpc('complete_platform_connect_flow',{
  p_flow:flow.id,p_user:flow.user_id,p_provider:flow.provider,
  p_claim:flow.completionClaim,p_connection:connection
 });
 if(error||data!==true)throw Error(error?.message||'connection_save_failed');
}
