import {Candidate,deNum,hhZip} from './shared.ts';
export function parseKaifuInventory(text:string){
  const rows=JSON.parse(text);if(!Array.isArray(rows))throw new Error('KAIFU inventory schema missing');const candidates:Candidate[]=[];
  for(const x of rows){
    if(!x.address||!Array.isArray(x.category)||!x.obj_details||!x.expenses)throw new Error('KAIFU apartment schema missing');
    if(!x.category.some((c:any)=>/wohnung|apartment/i.test(String(c.value)))||String(x.address.town).toLowerCase()!=='hamburg')continue;
    if(!x.refId||!hhZip(x.address.postcode)||!(deNum(x.obj_details.rooms)!>0)||!/^\/wohnen\/wohnungsangebote\/[^/]+$/.test(x.url))throw new Error('KAIFU residential identity missing');
    candidates.push({key:String(x.refId),url:new URL(x.url,'https://kaifu.de').href,title:x.headline,address:x.address.value,zip:x.address.postcode,cold:deNum(x.expenses.netto),warm:deNum(x.expenses.total),additional:deNum(x.expenses.additional),operating:deNum(x.expenses.operating_costs),heating:deNum(x.expenses.heating_costs),rooms:deNum(x.obj_details.rooms),area:deNum(x.obj_details.size),wbs:x.obj_details.wbs==='Ja',image:x.teaserImgUrl,raw:{provider:'kaifu_public_api'}});
  }
  return {candidates,enumerated:rows.length,complete:true};
}
export function parseFinkenInventory(text:string){
  const rows=JSON.parse(text);if(!Array.isArray(rows))throw new Error('Finkenwaerder inventory schema missing');const candidates:Candidate[]=[];
  for(const x of rows){
    if(!x.id||!x.city||!x.postalcode)throw new Error('Finkenwaerder apartment schema missing');
    if(x.city.toLowerCase()!=='hamburg'||!hhZip(x.postalcode)||!(deNum(x.numberOfRooms)!>0))continue;
    if(!/^https:\/\/tenant\.immomio\.com\/(?:de\/)?apply\/[0-9a-f-]{36}$/i.test(x.applicationLink))throw new Error('Finkenwaerder application identity missing');
    candidates.push({key:x.id,url:x.applicationLink,title:x.altText||`Wohnung ${x.street}`,address:[x.street,x.houseNumber,x.postalcode,'Hamburg'].filter(Boolean).join(' '),district:x.district,zip:x.postalcode,cold:deNum(x.baseRent),rooms:deNum(x.numberOfRooms),area:deNum(x.overallSpace),raw:{provider:'finkenwaerder_public_api'}});
  }
  return {candidates,enumerated:rows.length,complete:true};
}
