import {Candidate,deNum,hhZip} from './shared.ts';
export function parseKaifuInventory(text:string){
  const data=JSON.parse(text);
  if(data&&!Array.isArray(data)&&Array.isArray(data.result)&&data.filters?.type?.type==='selectfilter'&&data.filters?.rent?.type==='minmaxfilter'){
    const candidates:Candidate[]=[];
    for(const x of data.result){
      if(typeof x.type!=='string'||typeof x.address!=='string'||typeof x.url!=='string')throw new Error('KAIFU filter listing schema missing');
      if(!/wohnung|apartment/i.test(x.type)||!/\bHamburg\b/.test(x.address))continue;
      const url=new URL(x.url,'https://www.kaifu.de'),zip=x.address.match(/\b(\d{5})\b/)?.[1];
      if(url.hostname!=='www.kaifu.de'||!url.pathname.startsWith('/wohnen/')||!hhZip(zip)||!(deNum(x.rooms)!>0))throw new Error('KAIFU filter residential identity missing');
      candidates.push({key:url.pathname,url:url.href,title:x.title,address:x.address,zip,rooms:deNum(x.rooms),area:deNum(x.area),image:x.image,raw:{provider:'kaifu_public_api',advertised_monthly_price:deNum(x.rent),available_text:x.available}});
    }
    return {candidates,enumerated:data.result.length,complete:true};
  }
  const rows=data;if(!Array.isArray(rows))throw new Error('KAIFU inventory schema missing');const candidates:Candidate[]=[];
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
