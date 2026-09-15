import {decryptCredentials,getConnection,markConnection,saveConnection} from '../credentials.ts';

export async function importImmoScoutSession(db:any,userId:string,session:Record<string,unknown>,accountHint:string|null=null){
 if(!session||typeof session!=='object'||!String(session.cookie_header||''))throw Error('platform_session_invalid');
 return saveConnection(db,userId,'immoscout',session,{account_hint:accountHint,expires_at:null});
}

export async function checkImmoScoutConnection(db:any,userId:string){
 const row=await getConnection(db,userId,'immoscout');
 if(!row||row.status!=='connected')return {authenticated:false};
 try{
  const credentials=await decryptCredentials(db,row);
  if(!credentials?.cookie_header)throw Error('platform_session_invalid');
  // Do not claim the private web contract is valid until the authenticated
  // account check is captured in a controlled session trace.
  return {authenticated:null,status:'connected_unverified'};
 }catch{await markConnection(db,userId,'immoscout',{status:'needs_login',last_error:'session_invalid'}).catch(()=>{});return {authenticated:false};}
}

export async function sendImmoScoutApplication(_db:any,input:any){
 if(Number(input?.listing?.source_id)!==1)return {success:false,status:'failed',error:'invalid_listing_source'};
 // A reusable encrypted web session is the target (no official API). The exact
 // authenticated contact-submit request is intentionally not guessed. The source
 // remains disabled in app_private.application_platforms until a controlled trace
 // proves request, CSRF and success semantics.
 return {success:false,status:'manual_required',error:'provider_contract_unverified'};
}
