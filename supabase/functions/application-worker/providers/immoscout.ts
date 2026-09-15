import {saveConnection,getConnection,deleteConnection} from '../credentials.ts';

export async function importImmoScoutSession(db:any,userId:string,session:any,accountHint:string|null=null){
 const cookieHeader=String(session?.cookie_header||'').trim();
 if(!cookieHeader||cookieHeader.length>16000)throw Error('invalid_session');
 await saveConnection(db,userId,'immoscout',{cookie_header:cookieHeader},{account_hint:accountHint,last_error:'provider_contract_unverified'});
 return {status:'connected',authenticated:null};
}

export async function checkImmoScoutConnection(db:any,userId:string){
 const connection=await getConnection(db,userId,'immoscout');
 if(!connection?.credentials?.cookie_header)return {authenticated:false};
 // No endpoint is guessed here. Validation is enabled only after the controlled
 // Web-login/contact-submit contract has been captured and regression-tested.
 return {authenticated:null,status:'connected_unverified'};
}

export async function disconnectImmoScout(db:any,userId:string){await deleteConnection(db,userId,'immoscout');return {status:'disconnected'};}

// User requirement: no official ImmoScout API. The final implementation uses a
// persisted authenticated Web session and the same submit contract as the site.
// It remains fail-closed until that private contract is verified with a test account.
export async function sendImmoScoutApplication(){return {success:false,status:'manual_required',error:'provider_contract_unverified'};}
