import {sendImmoScoutApplication} from './immoscout.ts';
import {sendKleinanzeigenApplication} from './kleinanzeigen.ts';
import {immomioApplicationLink,sendImmomioApplication} from './immomio.ts';

const ATTACHMENT_CAPABILITIES:Record<string,{supported:boolean,mode:string}>={
 immoscout:{supported:false,mode:'contact_api_no_free_attachments'},
 kleinanzeigen:{supported:false,mode:'contact_json_no_attachments'},
 immomio:{supported:false,mode:'upload_contract_not_verified'},
 immowelt:{supported:false,mode:'no_auto_apply_provider'}
};
export function providerAttachmentCapability(provider:string){return ATTACHMENT_CAPABILITIES[provider]||{supported:false,mode:'provider_unsupported'};}
export function providerForListing(listing:any){if(Number(listing?.source_id)===1)return 'immoscout';if(Number(listing?.source_id)===2)return 'kleinanzeigen';if(immomioApplicationLink(listing))return 'immomio';return null;}
export async function sendApplication(provider:string,input:any){if(provider==='immoscout')return sendImmoScoutApplication(input);if(provider==='kleinanzeigen')return sendKleinanzeigenApplication(input);if(provider==='immomio')return sendImmomioApplication(input);return {success:false,status:'failed',error:'provider_unsupported'};}