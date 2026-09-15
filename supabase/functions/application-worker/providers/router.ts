import {sendImmoScoutApplication} from './immoscout.ts';
import {sendKleinanzeigenApplication} from './kleinanzeigen-send.ts';
import {immomioApplicationLink,sendImmomioApplication} from './immomio.ts';

export function providerForListing(listing:any){
 if(Number(listing?.source_id)===1)return 'immoscout';
 if(Number(listing?.source_id)===2)return 'kleinanzeigen';
 if(immomioApplicationLink(listing))return 'immomio';
 return null;
}

export async function sendApplication(provider:string,input:any){
 if(provider==='immoscout')return sendImmoScoutApplication(input);
 if(provider==='kleinanzeigen')return sendKleinanzeigenApplication(input);
 if(provider==='immomio')return sendImmomioApplication(input);
 return {success:false,status:'failed',error:'provider_unsupported'};
}
