import {sendImmoScoutApplication} from './immoscout.ts';
import {sendKleinanzeigenApplication} from './kleinanzeigen.ts';
import {immomioApplicationUrl,sendImmomioApplication} from './immomio.ts';

export type ProviderName='immoscout'|'kleinanzeigen'|'immomio';

export function providerForListing(listing:any):ProviderName|null{
 const source=Number(listing?.source_id);
 if(source===1)return 'immoscout';
 if(source===2)return 'kleinanzeigen';
 if(immomioApplicationUrl(listing))return 'immomio';
 return null;
}

export async function sendApplication(db:any,input:any){
 const provider=providerForListing(input?.listing);
 if(!provider)return {success:false,status:'failed',error:'provider_not_supported'};
 if(provider==='immoscout')return sendImmoScoutApplication(db,input);
 if(provider==='kleinanzeigen')return sendKleinanzeigenApplication(db,input);
 return sendImmomioApplication(db,input);
}
