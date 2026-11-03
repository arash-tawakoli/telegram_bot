// @ts-nocheck
export type ApplicationProvider='immowelt'|'immoscout'|'immomio';

const clean=(v:any)=>String(v??'').trim();
const norm=(v:any)=>clean(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,' ').trim();

const SALUTATION_ALIASES:Record<string,string>={
 mr:'MR',herr:'MR',male:'MR',mann:'MR','mannlich':'MR','maennlich':'MR',masculine:'MR',
 ms:'MS',mrs:'MS',frau:'MS',female:'MS','weiblich':'MS',feminine:'MS',
 diverse:'DIVERSE',divers:'DIVERSE',nonbinary:'DIVERSE','non binary':'DIVERSE',
 neutral:'NEUTRAL',
 company:'COMPANY',firma:'COMPANY',
 none:'NOT_SPECIFIED','keine angabe':'NOT_SPECIFIED','keine angaben':'NOT_SPECIFIED',
 'not specified':'NOT_SPECIFIED','no salutation':'NOT_SPECIFIED','no answer':'NOT_SPECIFIED'
};
const EMPLOYMENT_ALIASES:Record<string,string>={
 employee:'EMPLOYEE','angestellte r':'EMPLOYEE','angestellter':'EMPLOYEE','angestellte':'EMPLOYEE',
 worker:'WORKER','arbeiter in':'WORKER','arbeiter':'WORKER',
 selfemployed:'SELF_EMPLOYED','self employed':'SELF_EMPLOYED','selbststandige r':'SELF_EMPLOYED','selbststandig':'SELF_EMPLOYED',
 civilservant:'CIVIL_SERVANT','civil servant':'CIVIL_SERVANT','beamte r':'CIVIL_SERVANT','beamte r in':'CIVIL_SERVANT','beamter':'CIVIL_SERVANT',
 apprentice:'APPRENTICE','auszubildene r':'APPRENTICE','auszubildende r':'APPRENTICE','ausbildung':'APPRENTICE',
 student:'STUDENT','student in':'STUDENT','studierende r':'STUDENT','studierende in':'STUDENT','studium':'STUDENT',
 doctoral:'DOCTORAL','doktorand in':'DOCTORAL','promotion':'DOCTORAL',
 homemaker:'HOMEMAKER','haus frau mann':'HOMEMAKER','hausfrau mann':'HOMEMAKER',
 jobseeker:'JOBSEEKER','arbeitssuchende r':'JOBSEEKER','arbeitssuchend':'JOBSEEKER','arbeitslos':'JOBSEEKER',
 retired:'RETIRED','rentner in':'RETIRED','rentner':'RETIRED',
 other:'OTHER','sonstiges':'OTHER',
 none:'NOT_SPECIFIED','keine angabe':'NOT_SPECIFIED','keine angaben':'NOT_SPECIFIED','not specified':'NOT_SPECIFIED'
};

export function canonicalSalutation(value:any){
 const raw=clean(value);if(!raw)return null;
 if(['MR','MS','DIVERSE','NEUTRAL','NOT_SPECIFIED','COMPANY'].includes(raw))return raw;
 const n=norm(raw);return SALUTATION_ALIASES[n]||SALUTATION_ALIASES[n.replace(/ /g,'')]||null;
}
export function canonicalEmployment(value:any){
 const raw=clean(value);if(!raw)return null;
 if(['EMPLOYEE','WORKER','SELF_EMPLOYED','CIVIL_SERVANT','APPRENTICE','STUDENT','DOCTORAL','HOMEMAKER','JOBSEEKER','RETIRED','OTHER','NOT_SPECIFIED'].includes(raw))return raw;
 const n=norm(raw);return EMPLOYMENT_ALIASES[n]||EMPLOYMENT_ALIASES[n.replace(/ /g,'')]||null;
}
export function canonicalHousehold(value:any){
 const raw=clean(value);if(['SINGLE','TWO_ADULTS','FAMILY','SHARED_FLAT','NOT_SPECIFIED'].includes(raw))return raw;
 const n=norm(raw);
 if(/einperson|single|allein|one person/.test(n))return'SINGLE';
 if(/zwei erwachsene|zweiperson|two adults|two person|two people|paar/.test(n))return'TWO_ADULTS';
 if(/famil/.test(n))return'FAMILY';
 if(/wohngemeinschaft|\bwg\b|shared flat/.test(n))return'SHARED_FLAT';
 if(/keine angabe|not specified|no answer/.test(n))return'NOT_SPECIFIED';
 return null;
}
export function canonicalIncome(value:any){
 const raw=clean(value);if(!raw)return null;
 const allowed=['UNDER_500','500_1000','1000_1500','1500_2000','2000_3000','3000_4000','4000_5000','OVER_5000','5000_6000','6000_7000','OVER_7000','HOUSING_BENEFIT','NOT_SPECIFIED'];
 if(allowed.includes(raw))return raw;
 const n=norm(raw);
 if(/wohngeld|housing benefit/.test(n))return'HOUSING_BENEFIT';
 if(/keine angabe|not specified|no answer/.test(n))return'NOT_SPECIFIED';
 const compact=raw.replace(/\./g,'').replace(/,/g,'.');
 const numbers=(compact.match(/\d+(?:\.\d+)?/g)||[]).map(Number);
 if(/unter|under|less than|below|</.test(n)&&numbers[0]===500)return'UNDER_500';
 if(/uber|over|more than|above|>/.test(n)&&numbers[0]===5000)return'OVER_5000';
 if(numbers.length>=2){
  const pair=[numbers[0],numbers[1]].join('_');
  if(['500_1000','1000_1500','1500_2000','2000_3000','3000_4000','4000_5000','5000_6000','6000_7000'].includes(pair))return pair;
 }
 return null;
}
export function canonicalMoveIn(value:any){
 const raw=clean(value);
 if(['NOT_SPECIFIED','FLEXIBLE','IMMEDIATE','EXACT_DATE','WITHIN_1_MONTH','WITHIN_3_MONTHS','AFTER_3_MONTHS'].includes(raw))return raw;
 const n=norm(raw);
 if(/sofort|so bald|as soon/.test(n))return'IMMEDIATE';
 if(/flexibel|flexible/.test(n))return'FLEXIBLE';
 if(/genaues datum|exact date/.test(n))return'EXACT_DATE';
 if(/< ?1 monat|innerhalb 1 monat|within 1 month/.test(n))return'WITHIN_1_MONTH';
 if(/< ?3 monate|innerhalb 3 monate|within 3 months/.test(n))return'WITHIN_3_MONTHS';
 if(/> ?3 monate|spater als 3 monate|after 3 months/.test(n))return'AFTER_3_MONTHS';
 if(/keine angabe|not specified|no answer/.test(n))return'NOT_SPECIFIED';
 return null;
}
export function canonicalSchufa(value:any){
 const raw=clean(value);if(!raw)return'NOT_SPECIFIED';
 if(raw==='AVAILABLE')return'PRESENT_RECENT';
 if(['PRESENT_RECENT','NOT_AVAILABLE','NOT_SPECIFIED'].includes(raw))return raw;
 const n=norm(raw);
 if(/keine angabe|not specified|no answer/.test(n))return'NOT_SPECIFIED';
 if(/nicht vorhanden|not available|no schufa|^nein$|^no$/.test(n))return'NOT_AVAILABLE';
 if(/vorhanden|present|^ja$|^yes$/.test(n))return'PRESENT_RECENT';
 return null;
}

const EMPLOYMENT_LABELS:Record<string,string>={
 EMPLOYEE:'Angestellte(r)',WORKER:'Arbeiter(in)',SELF_EMPLOYED:'Selbstständige(r)',CIVIL_SERVANT:'Beamte(r)',
 APPRENTICE:'Auszubildende(r)',STUDENT:'Studierende(r)',DOCTORAL:'Doktorand(in)',HOMEMAKER:'Hausfrau/mann',
 JOBSEEKER:'Arbeitssuchende(r)',RETIRED:'Rentner(in)',OTHER:'Sonstiges'
};
const HOUSEHOLD_LABELS:Record<string,string>={
 SINGLE:'Einpersonenhaushalt',TWO_ADULTS:'Zwei Erwachsene',FAMILY:'Familie',SHARED_FLAT:'Wohngemeinschaft'
};
const SCOUT_INCOME:Record<string,string>={
 UNDER_500:'Unter 500€','500_1000':'500€ - 1.000€','1000_1500':'1.000€ - 1.500€','1500_2000':'1.500€ - 2.000€',
 '2000_3000':'2.000€ - 3.000€','3000_4000':'3.000€ - 4.000€','4000_5000':'4.000€ - 5.000€',
 OVER_5000:'Über 5000€','5000_6000':'Über 5000€','6000_7000':'Über 5000€',OVER_7000:'Über 5000€'
};
const IMMOWELT_INCOME:Record<string,string>={
 UNDER_500:'< €1.000','500_1000':'< €1.000','1000_1500':'1.000 € - 2.000 €','1500_2000':'1.000 € - 2.000 €',
 '2000_3000':'2.000 € - 3.000 €','3000_4000':'3.000 € - 4.000 €','4000_5000':'4.000 € - 5.000 €',
 '5000_6000':'5.000 € - 6.000 €','6000_7000':'6.000 € - 7.000 €',OVER_7000:'> 7.000 €',
 HOUSING_BENEFIT:'Ich beziehe Wohngeld',NOT_SPECIFIED:'Ich möchte keine Angabe machen'
};

function dateOrdinal(raw:any){
 const value=clean(raw);if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));
 if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
 return Date.UTC(year,month-1,day);
}
function berlinTodayOrdinal(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(type:string)=>Number(parts.find(x=>x.type===type)?.value||0);
 return Date.UTC(part('year'),part('month')-1,part('day'));
}
function daysUntil(value:any){
 const target=dateOrdinal(value);if(target==null)return null;
 return Math.floor((target-berlinTodayOrdinal())/86400000);
}
export function providerSalutation(provider:ApplicationProvider,value:any){if(provider==='immomio')return null;const v=canonicalSalutation(value);if(!v)return null;if(provider==='immoscout'){if(v==='MR')return'MALE';if(v==='MS')return'FEMALE';if(v==='COMPANY')return'COMPANY';return null;}if(v==='MR')return'Herr';if(v==='MS')return'Frau';if(v==='DIVERSE')return'Divers';if(v==='NEUTRAL')return'Neutral';return null;}
export function providerHousehold(provider:ApplicationProvider,value:any){if(provider==='immomio')return null;const v=canonicalHousehold(value);if(!v)return null;if(v==='NOT_SPECIFIED')return provider==='immowelt'?'Ich möchte keine Angabe machen':null;return HOUSEHOLD_LABELS[v]||null;}
export function providerEmployment(provider:ApplicationProvider,value:any){if(provider==='immomio')return null;const v=canonicalEmployment(value);if(!v)return null;if(v==='NOT_SPECIFIED')return provider==='immowelt'?'Ich möchte keine Angabe machen':null;if(provider==='immowelt'&&v==='DOCTORAL')return'Sonstiges';if(provider==='immowelt'&&v==='HOMEMAKER')return'Hausfrau/mann';return EMPLOYMENT_LABELS[v]||null;}
export function providerIncome(provider:ApplicationProvider,value:any){if(provider==='immomio')return null;const v=canonicalIncome(value);if(!v)return null;if(v==='HOUSING_BENEFIT')return provider==='immowelt'?'Ich beziehe Wohngeld':null;if(provider==='immowelt'){if(v==='OVER_5000')return'Ich möchte keine Angabe machen';return IMMOWELT_INCOME[v]||null;}if(v==='NOT_SPECIFIED')return null;return SCOUT_INCOME[v]||null;}
function petKind(value:any){
 const raw=clean(value),n=norm(raw);
 if(!raw||/keine angabe|keine angaben|not specified|no answer/.test(n))return{kind:'NOT_SPECIFIED',raw};
 if(/keine haustiere|keine tiere|no pets|^nein$|^no$|^false$/.test(n))return{kind:'NO_PETS',raw};
 if(/^ja$|^yes$|^true$/.test(n))return{kind:'YES',raw};
 const small=/(hamster|meerschwein|kaninchen|maus|ratte|vogel|fisch|schildkrot|schlange|kleintier)/.test(n);
 const larger=/(hund|katze|pferd|pony|papagei|frettchen)/.test(n);
 if(small&&!larger)return{kind:'SMALL_ONLY',raw};
 return{kind:'SPECIFIC',raw};
}
export function providerPets(provider:ApplicationProvider,value:any){if(provider==='immomio')return null;const pet=petKind(value);if(pet.kind==='NOT_SPECIFIED')return'Keine Angaben';if(pet.kind==='NO_PETS'||pet.kind==='SMALL_ONLY')return'Nein';return'Ja';}
export function providerMoveIn(provider:ApplicationProvider,profile:any){if(provider==='immomio')return null;const v=canonicalMoveIn(profile?.move_in_preference);if(!v)return null;if(provider==='immowelt'){if(v==='IMMEDIATE')return'So bald wie möglich';if(v==='WITHIN_1_MONTH')return'<1 Monat';if(v==='WITHIN_3_MONTHS')return'<3 Monate';if(v==='AFTER_3_MONTHS')return'>3 Monate';if(v==='FLEXIBLE')return'Ich bin flexibel';if(v==='NOT_SPECIFIED')return'Ich möchte keine Angabe machen';if(v==='EXACT_DATE'){const d=daysUntil(profile?.move_in_date);if(d==null)return null;if(d<=0)return'So bald wie möglich';if(d<=30)return'<1 Monat';if(d<=90)return'<3 Monate';return'>3 Monate';}}if(v==='NOT_SPECIFIED')return null;if(v==='FLEXIBLE')return'Flexibel';if(v==='IMMEDIATE')return'Sofort';if(v==='WITHIN_1_MONTH')return'Innerhalb 1 Monat';if(v==='WITHIN_3_MONTHS')return'Innerhalb 3 Monate';if(v==='AFTER_3_MONTHS')return'Später als 3 Monate';if(v==='EXACT_DATE')return clean(profile?.move_in_date)||null;return null;}
export function providerEnumCandidates(provider:ApplicationProvider,semantic:string,profile:any){
 if(provider==='immomio')return[];
 const key=String(semantic||'').toLowerCase();
 let value:any=null;
 if(/salutation|anrede/.test(key))value=providerSalutation(provider,profile?.salutation);
 else if(/pet|haustier/.test(key))value=providerPets(provider,profile?.pets);
 else if(/household|haushalt|numberofpersons|personen/.test(key))value=providerHousehold(provider,profile?.household_type);
 else if(/employment|beruf|job|occupation/.test(key))value=providerEmployment(provider,profile?.employment_status);
 else if(/income|einkommen/.test(key))value=providerIncome(provider,profile?.income_range);
 else if(/move.?in|einzug/.test(key))value=providerMoveIn(provider,profile);
 return value==null?[]:[value];
}
export function providerStaticMissing(provider:ApplicationProvider,profile:any,message?:string){if(provider==='immomio')return[];const missing:string[]=[];const add=(label:string,value:any)=>{if(!clean(value))missing.push(label)};const selected=(label:string,value:any)=>{if(value==null)missing.push(label)};add('Vorname',profile?.first_name);add('Nachname',profile?.last_name);if(provider==='immoscout'||provider==='immowelt'){if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(profile?.email)))missing.push('E-Mail-Adresse');}selected('Anrede',canonicalSalutation(profile?.salutation));add('Straße',profile?.street);add('Hausnummer',profile?.house_number);if(!/^\d{5}$/.test(clean(profile?.postcode)))missing.push('PLZ');add('Ort',profile?.city);if(message!==undefined&&!clean(message))missing.push('Bewerbungstext');return [...new Set(missing)];}
export function profileAdapterSelfTest(){
 const checks={
  mrToImmowelt:providerSalutation('immowelt','MR')==='Herr',
  mrToImmoScout:providerSalutation('immoscout','MR')==='MALE',
  companyToImmoScout:providerSalutation('immoscout','COMPANY')==='COMPANY',
  diverseToImmowelt:providerSalutation('immowelt','DIVERSE')==='Neutral',
  diverseToImmoScout:providerSalutation('immoscout','DIVERSE')===null,
  noHouseholdToImmowelt:providerHousehold('immowelt','NOT_SPECIFIED')==='Ich möchte keine Angabe machen',
  doctoralToImmowelt:providerEmployment('immowelt','DOCTORAL')==='Sonstiges',
  over5000ToImmowelt:providerIncome('immowelt','OVER_5000')==='Ich möchte keine Angabe machen',
  immomioHasNoRequirements:providerStaticMissing('immomio',{},'').length===0,
   immoweltRequiresSalutation:providerStaticMissing('immowelt',{first_name:'Alex',last_name:'Example',email:'alex@example.com'},'Message').includes('Anrede'),
  noAnswerToImmoScoutIsOmitted:providerSalutation('immoscout','NEUTRAL')===null,
  immomioHasNoSalutation:providerSalutation('immomio','MR')===null
 };
 return{ok:Object.values(checks).every(Boolean),checks};
}
