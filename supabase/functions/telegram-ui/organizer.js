import {db,button,send,edit,esc,short,money,saveState} from './runtime.js';
import {premium} from './navigation.js';
import {structuredFacts,present} from '../notification-dispatcher/source-facts.ts';

export const APPLICATION_STATUS={saved:'⭐ Gemerkt',contacted:'📨 Angefragt',viewing:'📅 Besichtigung',applied:'📄 Beworben',rejected:'❌ Absage',accepted:'✅ Zusage'};
const PAGE_SIZE=6;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Two UUIDs fit inside Telegram's 64-byte callback limit without mutable comparison state.
export function packId(id){if(!UUID.test(id))throw Error('Invalid listing ID');return btoa(String.fromCharCode(...id.replaceAll('-','').match(/../g).map(x=>parseInt(x,16)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
export function unpackId(value){if(!/^[A-Za-z0-9_-]{22}$/.test(value||''))return null;try{const hex=[...atob(value.replaceAll('-','+').replaceAll('_','/')+'==')].map(x=>x.charCodeAt(0).toString(16).padStart(2,'0')).join('');const id=hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');return UUID.test(id)&&packId(id)===value?id:null;}catch{return null;}}
export function organizerFacts(l){
  const direct=structuredFacts(l.raw,l.canonical_url);
  const preview=l.raw?.provider==='immosolve_hpm_rest'?null:l.enrichment_evidence?.preview;
  const detail=preview?.canonical_url===l.canonical_url?preview.facts||{}:{};
  const f={...l,...direct,...detail};
  f.address=Object.hasOwn(detail,'address')?detail.address:direct.address;
  if(l.warm_rent_is_calculated&&direct.warm_rent==null&&detail.warm_rent==null)f.warm_rent=null;
  return f;
}
const validNumber=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))&&Number(x)>=0;
const amountLine=(title,value,unit=' €')=>validNumber(value)?`${title}: ${new Intl.NumberFormat('de-DE',{maximumFractionDigits:2}).format(Number(value))}${unit}`:null;
function knownLines(f){return [amountLine('Warmmiete',f.warm_rent),amountLine('Kaltmiete',f.cold_rent),amountLine('Nebenkosten',f.additional_costs),amountLine('Heizkosten',f.heating_costs),amountLine('Kaution',f.deposit),amountLine('Wohnfläche',f.area_sqm,' m²'),amountLine('Zimmer',f.rooms,''),present(f.address)?`Adresse: ${esc(f.address)}`:null,present(f.floor)?`Etage: ${esc(f.floor)}`:null,present(f.available_text)?`Verfügbar ab: ${esc(f.available_text)}`:null].filter(Boolean);}
export function comparisonText(a,b){
  const x=organizerFacts(a),y=organizerFacts(b);
  const lines=['⚖️ <b>Wohnungsvergleich</b>'];
  for(const [tag,l,f] of [['A',a,x],['B',b,y]])lines.push('',`<b>${tag} · ${esc(short(l.title,140))}</b>`,...(l.is_active===false?['⚠️ Von der Quelle als inaktiv markiert.']:[]),...knownLines(f));
  if(validNumber(x.warm_rent)&&validNumber(y.warm_rent)){
    const d=Number(x.warm_rent)-Number(y.warm_rent);
    lines.push('',d===0?'Beide haben dieselbe ausgewiesene Warmmiete.':`${d<0?'A':'B'} hat ${money(Math.abs(d))} weniger Warmmiete pro Monat.`);
  }
  if(validNumber(x.area_sqm)&&validNumber(y.area_sqm)&&Number(x.area_sqm)!==Number(y.area_sqm))lines.push(`${Number(x.area_sqm)>Number(y.area_sqm)?'A':'B'} bietet ${new Intl.NumberFormat('de-DE',{maximumFractionDigits:2}).format(Math.abs(Number(x.area_sqm)-Number(y.area_sqm)))} m² mehr Wohnfläche.`);
  lines.push('','Datenstand der gespeicherten Quelle; Verfügbarkeit bitte beim Anbieter bestätigen.');
  return lines.join('\n');
}
export function costText(l){
  const f=organizerFacts(l),lines=['💶 <b>Kostenübersicht</b>',esc(short(l.title,140)),''];
  for(const [label,key] of [['Warmmiete / Monat','warm_rent'],['Kaltmiete / Monat','cold_rent'],['Nebenkosten / Monat','additional_costs'],['Heizkosten / Monat','heating_costs'],['Betriebskosten / Monat','operating_costs'],['Ausgewiesene Kaution','deposit']]){const line=amountLine(label,f[key]);if(line)lines.push(line);}
  if(present(f.deposit_text))lines.push(`Kaution laut Quelle: ${esc(f.deposit_text)}`);
  if(present(f.heating_text))lines.push(`Heizkosten laut Quelle: ${esc(f.heating_text)}`);
  if(validNumber(f.warm_rent)&&Number(f.warm_rent)>0){
    lines.push('',`<b>Rechnerisch:</b> 12 Monatswarmmieten = ${money(Number(f.warm_rent)*12)}`);
    if(validNumber(f.deposit))lines.push(`Eine Monatswarmmiete + ausgewiesene Kaution = ${money(Number(f.warm_rent)+Number(f.deposit))}`);
  }
  if(validNumber(f.cold_rent)&&validNumber(f.area_sqm)&&Number(f.area_sqm)>0)lines.push(`Kaltmiete pro m² = ${money(Number(f.cold_rent)/Number(f.area_sqm))}`);
  lines.push('','Mietbestandteile werden nicht doppelt addiert. Die Rechnung ist kein Zahlungsplan; weitere persönliche Kosten sind nicht enthalten.');return lines.join('\n');
}
export function contactText(l,kind){
  const title=short(l.title,160);
  const drafts={inquiry:`Guten Tag,\n\nich interessiere mich für Ihr Angebot „${title}“. Ist die Wohnung noch verfügbar? Ich würde sie gern besichtigen. Welche Termine und Unterlagen kommen dafür infrage?\n\nVielen Dank und freundliche Grüße\n[Dein Name]`,followup:`Guten Tag,\n\nich möchte zu meiner Anfrage für „${title}“ nachfragen. Besteht noch die Möglichkeit einer Besichtigung? Über eine kurze Rückmeldung freue ich mich.\n\nFreundliche Grüße\n[Dein Name]`};
  return '✉️ <b>Kontaktentwurf</b>\n\nVor dem Kopieren prüfen und [Dein Name] ersetzen.\n\n'+esc(drafts[kind]||drafts.inquiry)+'\n\nDer Bot versendet diesen Text nicht an den Anbieter.';
}
const render=(chat,id,text,rows)=>id?edit(chat,id,text,{inline_keyboard:rows}):send(chat,text,{inline_keyboard:rows});
const back=token=>[[button('← Wohnung',`org:view:${token}`)],[button('🗂 Wohnungsplaner','org:list:0')]];
async function owned(user,id){
  const {data,error}=await db.from('saved_listings').select('listing_id,status,note,listings(*)').eq('user_id',user.id).eq('listing_id',id).maybeSingle();
  if(error)throw error;return data;
}
export async function clearOrganizerNote(user){
  if(!user.onboarding_state?.organizer_note)return;
  const state={...user.onboarding_state};delete state.organizer_note;
  await saveState(user.id,user.onboarding_step,state);user.onboarding_state=state;
}
export async function organizerMessage(message,user){
  const pending=user.onboarding_state?.organizer_note;
  if(!pending)return false;
  const text=String(message.text||'').trim(),chat=Number(message.chat.id);
  if(text.startsWith('/')){await clearOrganizerNote(user);return false;}
  if(!user.is_premium||Date.now()-Number(pending.started_at)>10*60*1000){await clearOrganizerNote(user);await send(chat,'Die Notizeingabe ist abgelaufen. Öffne die Wohnung erneut im Wohnungsplaner.');return true;}
  if(!text||text.length>1500){await send(chat,'Bitte eine Notiz mit 1 bis 1.500 Zeichen senden.');return true;}
  const id=unpackId(pending.token),row=id?await owned(user,id):null;
  if(!row){await clearOrganizerNote(user);await send(chat,'Diese Wohnung ist nicht mehr in deiner Merkliste.');return true;}
  const {error}=await db.from('saved_listings').update({note:text,updated_at:new Date().toISOString()}).eq('user_id',user.id).eq('listing_id',id);
  if(error)throw error;
  await clearOrganizerNote(user);
  await organizer(user,chat,undefined,`org:view:${pending.token}`);return true;
}
export async function organizer(user,chat,messageId,data='org:list:0'){
  if(!user.is_premium)return premium(user,chat,messageId);
  const [,action='list',token='',value='']=String(data).split(':');
  if(action==='list'||action==='pick'){
    const page=Math.max(0,Math.floor(Math.min(10000,Number(action==='list'?token:value)||0)));
    const base=action==='pick'?unpackId(token):null;
    if(action==='pick'&&(!base||!await owned(user,base)))return render(chat,messageId,'Bitte zuerst eine gespeicherte Wohnung wählen.',[[button('🗂 Wohnungsplaner','org:list:0')]]);
    const {data:rows,count,error}=await db.from('saved_listings').select('listing_id,status,listings(title,is_active)',{count:'exact'}).eq('user_id',user.id).order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*PAGE_SIZE,page*PAGE_SIZE+PAGE_SIZE-1);
    if(error)throw error;
    if(page>0&&!rows?.length)return organizer(user,chat,messageId,action==='list'?'org:list:0':`org:pick:${token}:0`);
    const keyboard=(rows||[]).filter(r=>r.listing_id!==base).map(r=>[button(`${r.listings?.is_active===false?'⚠️ ':''}${APPLICATION_STATUS[r.status]||APPLICATION_STATUS.saved} · ${short(r.listings?.title,38)}`,action==='pick'?`org:compare:${token}:${packId(r.listing_id)}`:`org:view:${packId(r.listing_id)}`)]);
    const nav=[];if(page>0)nav.push(button('← Zurück',action==='list'?`org:list:${page-1}`:`org:pick:${token}:${page-1}`));
    if((page+1)*PAGE_SIZE<(count||0))nav.push(button('Weiter →',action==='list'?`org:list:${page+1}`:`org:pick:${token}:${page+1}`));if(nav.length)keyboard.push(nav);
    keyboard.push([button('← Startmenü','home')]);
    const text=action==='pick'?'⚖️ <b>Zweite Wohnung wählen</b>\n\nWähle ein anderes gespeichertes Angebot.':'🗂 <b>Wohnungsplaner</b>\n\nStatus verfolgen, Notizen festhalten, Wohnungen vergleichen, Kontakttexte vorbereiten und Kosten überblicken.\n\n'+(count?`${count} gespeicherte Wohnungen · Seite ${page+1}`:'Speichere zuerst ein Angebot mit ⭐️ Speichern.');
    return render(chat,messageId,text,keyboard);
  }
  const id=unpackId(token),row=id?await owned(user,id):null;
  if(!row?.listings)return render(chat,messageId,'Diese Wohnung ist nicht in deiner Merkliste.',[[button('🗂 Wohnungsplaner','org:list:0')]]);
  const l=row.listings;
  if(action==='status'){
    if(Object.hasOwn(APPLICATION_STATUS,value)){
      const {error}=await db.from('saved_listings').update({status:value,updated_at:new Date().toISOString()}).eq('user_id',user.id).eq('listing_id',id);if(error)throw error;
      return organizer(user,chat,messageId,`org:view:${token}`);
    }
    return render(chat,messageId,'📋 <b>Bewerbungsstatus setzen</b>\n\n'+esc(short(l.title,140)),[...Object.entries(APPLICATION_STATUS).map(([key,label])=>[button(label,`org:status:${token}:${key}`)]),...back(token)]);
  }
  if(action==='note'){
    if(value==='clear'){
      const {error}=await db.from('saved_listings').update({note:null,updated_at:new Date().toISOString()}).eq('user_id',user.id).eq('listing_id',id);if(error)throw error;
      await clearOrganizerNote(user);return organizer(user,chat,messageId,`org:view:${token}`);
    }
    await saveState(user.id,user.onboarding_step,{...user.onboarding_state,organizer_note:{token,started_at:Date.now()}});
    return render(chat,messageId,'📝 <b>Private Notiz</b>\n\nSende deine Notiz als nächste Nachricht (max. 1.500 Zeichen, innerhalb von 10 Minuten). Sie ersetzt die bisherige Notiz. Nur du kannst sie im Bot sehen.',[[button('Notiz löschen',`org:note:${token}:clear`)],...back(token)]);
  }
  if(action==='cost')return render(chat,messageId,costText(l),back(token));
  if(action==='draft')return render(chat,messageId,contactText(l,value),[[button('Anfrage',`org:draft:${token}:inquiry`),button('Nachfassen',`org:draft:${token}:followup`)],...back(token)]);
  if(action==='compare'){
    const second=unpackId(value),other=second&&second!==id?await owned(user,second):null;
    if(!other?.listings)return render(chat,messageId,'Bitte eine andere gespeicherte Wohnung wählen.',[[button('Wohnung wählen',`org:pick:${token}:0`)],...back(token)]);
    return render(chat,messageId,comparisonText(l,other.listings),back(token));
  }
  const text=['🏠 <b>'+esc(short(l.title,140))+'</b>',l.is_active===false?'⚠️ Von der Quelle als inaktiv markiert.':null,'',`<b>Dein Status:</b> ${APPLICATION_STATUS[row.status]||APPLICATION_STATUS.saved}`,row.note?`\n<b>Deine Notiz:</b>\n${esc(row.note)}`:null].filter(x=>x!==null).join('\n');
  const rows=[[button('📋 Status',`org:status:${token}`),button('📝 Notiz',`org:note:${token}`)],[button('⚖️ Vergleichen',`org:pick:${token}:0`),button('💶 Kosten',`org:cost:${token}`)],[button('✉️ Kontaktentwurf',`org:draft:${token}:inquiry`)]];
  try{const url=new URL(l.canonical_url);if(['https:','http:'].includes(url.protocol))rows.push([{text:'Angebot öffnen',url:url.href}]);}catch{}
  rows.push([button('← Wohnungsplaner','org:list:0')]);return render(chat,messageId,text,rows);
}
