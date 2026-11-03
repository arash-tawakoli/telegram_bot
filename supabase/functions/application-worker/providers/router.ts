import {sendImmoScoutApplication} from './immoscout.ts';
import {immomioApplicationLink,sendImmomioApplication} from './immomio.ts';
import {sendImmoweltApplication} from './immowelt.ts';

const ATTACHMENT_CAPABILITIES:Record<string,{supported:boolean,mode:string}>={
 immoscout:{supported:false,mode:'secure_application_package_link'},
 immomio:{supported:false,mode:'native_profile_upload_specialized_worker'},
 immowelt:{supported:false,mode:'account_connected_transport_gated'}
};
export function providerAttachmentCapability(provider:string){return ATTACHMENT_CAPABILITIES[provider]||{supported:false,mode:'provider_unsupported'};}
export function providerForListing(listing:any){if(immomioApplicationLink(listing))return 'immomio';if(Number(listing?.source_id)===1)return 'immoscout';if(Number(listing?.source_id)===3)return 'immowelt';return null;}
export async function sendApplication(provider:string,input:any){if(provider==='immoscout')return sendImmoScoutApplication(input);if(provider==='immomio')return sendImmomioApplication(input);if(provider==='immowelt')return sendImmoweltApplication(input);return {success:false,status:'failed',error:'provider_unsupported'};}