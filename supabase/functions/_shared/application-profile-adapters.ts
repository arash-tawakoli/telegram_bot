// @ts-nocheck
export type ApplicationProvider='immowelt'|'immoscout'|'kleinanzeigen'|'immomio';

const clean=(v:any)=>String(v??'').trim();
const norm=(v:any)=>clean(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,' ').trim();

const SALUTATION_ALIASES:Record<string,string>={
 mr:'MR',herr:'MR',male:'MR',mann:'MR','mannlich':'MR','maennlich':'MR',
 ms:'MS',mrs:'MS',frau:'MS',female:'MS','weiblich':'MS',
 diverse:'DIVERSE',divers:'DIVERSE',
 neutral:'NEUTRAL',
 company:'COMPANY',firma:'COMPANY',
 none:'NOT_SPECIFIED','keine angabe':'NOT_SPECIFIED','keine angaben':'NOT_SPECIFIED','not specified':'NOT_SPECIFIED'
};
const EMPLOYMENT_ALIASES:Record<string,string>={
 employee:'EMPLOYEE','angestellte r':'EMPLOYEE','angestellt':'EMPLOYEE',
 worker:'WORKER','arbeiter in':'WORKER','arbeiter':'WORKER',
 selfemployed:'SELF_EMPLOYED','self employed':'SELF_EMPLOYED','selbststandige r':'SELF_EMPLOYED','selbststandig':'SELF_EMPLOYED',
 civilservant:'CIVIL_SERVANT','civil servant':'CIVIL_SERVANT','beamte r':'CIVIL_SERVANT','beamter':'CIVIL_SERVANT',
 apprentice:'APPRENTICE','auszubildene r':'APPRENTICE','auszubildende r':'APPRENTICE','ausbildung':'APPRENTICE',
 student:'STUDENT','studierende r':'STUDENT','studium':'STUDENT',
 doctoral:'DOCTORAL','doktorand in':'DOCTORAL','promotion':'DOCTORAL',
 homemaker:'HOMEMAKER','hausfrau mann':'HOMEMAKER','hausfrau -mann':'HOMEMAKER',
 jobseeker:'JOBSEEKER','arbeitssuchende r':'JOBSEEKER','arbeitssuchend':'JOBSEEKER','arbeitslos':'JOBSEEKER',
 retired:'RETIRED','rentner in':'RETIRED','rentner':'RETIRED',
 other:'OTHER','sonstiges':'OTHER',
 none:'NOT_SPECIFIED','keine angabe':'NOT_SPECIFIED','keine angaben':'NOT_SPECIFIED','not specified':'NOT_SPECIFIED'
};

export function canonicalSalutation(value:any){
 const raw=clean(value);if(!raw)return null;
 if(['MR','MS','DIVERSE','NEUTRAL','NOT_SPECIFIED','COMPANY'].includes(raw))return raw;
 return SALUTATION_ALIASES[norm(raw).replace(/ /g,'')]||SALUTATION_ALIASES[norm(raw)]||null;
}
export function canonicalEmployment(value:any){
 const raw=clean(value);if(!raw)return null;
 if(['EMPLOYEE','WORKER','SELF_EMPLOYED','CIVIL_SERVANT','APPRENTICE','STUDENT','DOCTORAL','HOMEMAKER','JOBSEEKER','RETIRED','OTHER','NOT_SPECIFIED'].includes(raw))return raw;
 const n=norm(raw);return EMPLOYMENT_ALIASES[n]||EMPLOYMENT_ALIASES[n.replace(/ /g,'')]||null;
}
export function canonicalHousehold(value:any){
 const raw=clean(value);if(['SINGLE','TWO_ADULTS','FAMILY','SHARED_FLAT','NOT_SPECIFIED'].includes(raw))return raw;
 const n=norm(raw);
 if(/einperson|single|allein/.test(n))return'SINGLE';
 if(/zwei erwachsene|two adults|paar/.test(n))return'TWO_ADULTS';
 if(/famil/.test(n))return'FAMILY';
 if(/wohngemeinschaft|\bwg\b|shared/.test(n))return'SHARED_FLAT';
 if(/keine angabe|not specified/.test(n))return'NOT_SPECIFIED';
 return null;
}
export function canonicalIncome(value:any){
 const raw=clean(value);
 const allowed=['UNDER_500','500_1000','1000_1500','1500_2000','2000_3000','3000_4000','4000_5000','OVER_5000','5000_6000','6000_7000','OVER_7000','HOUSING_BENEFIT','NOT_SPECIFIED'];
 if(allowed.includes(raw))return raw;
 const n=norm(raw);
 if(/wohngeld/.test(n))return'HOUSING_BENEFIT';
 if(/keine angabe|not specified/.test(n))return'NOT_SPECIFIED';
 return null;
}
export function canonicalMoveIn(value:any){
 const raw=clean(value);
 if(['NOT_SPECIFIED','FLEXIBLE','IMMEDIATE','EXACT_DATE','WITHIN_1_MONTH','WITHIN_3_MONTHS','AFTER_3_MONTHS'].includes(raw))return raw;
 const n=norm(raw);
 if(/sofort|so bald|as soon/.test(n))return'IMMEDIATE';
 if(/flexibel|flexible/.test(n))return'FLEXIBLE';
 if(/< ?1 monat|innerhalb 1 monat/.test(n))return'WITHIN_1_MONTH';
 if(/< ?3 monate|innerhalb 3 monate/.test(n))return'WITHIN_3_MONTHS';
 if(/> ?3 monate|spater als 3 monate/.test(n))return'AFTER_3_MONTHS';
 if(/keine angabe|not specified/.test(n))return'NOT_SPECIFIED';
 return null;
}

const EMPLOYMENT_LABELS:Record<string,string>={
 EMPLOYEE:'Angestellte(r)',WORKER:'Arbeiter(in)',SELF_EMPLOYED:'Selbstständige(r)',CIVIL_SERVANT:'Beamte(r)',
 APPRENTICE:'Auszubildende(r)',STUDENT:'Studierende(r)',DOCTORAL:'Doktorand(in)',HOMEMAKER:'Hausfrau/-mann',
 JOBSEEKER:'Arbeitssuchende(r)',RETIRED:'Rentner(in)',OTHER:'Sonstiges'
};
const HOUSEHOLD_LABELS:Record<string,string>={
 SINGLE:'Einpersonenhaushalt',TWO_ADULTS:'Zwei Erwachsene',FAMILY:'Familie',SHARED_FLAT:'Wohngemeinschaft'
};
const SCOUT_INCOME:Record<string,string>={
 UNDER_500:'Unter 500€','500_1000':'500€ - 1.000€','1000_1500':'1.000€ - 1.500€','1500_2000':'1.500€ - 2.000€',
 '2000_3000':'2.000€ - 3.000€','3000_4000':'3.000€ - 4.000€','4000_5000':'4.000€ - 5.000€',
 OVER_5000:'Über 5000€','5000_6000':'Über 5000€','6000_7000':'Über 5000€',OVER_7000:'Über 5000€',
 HOUSING_BENEFIT:'Keine Angaben',NOT_SPECIFIED:'Keine Angaben'
};
const IMMOWELT_INCOME:Record<string,string>={
 UNDER_500:'< €1.000','500_1000':'< €1.000','1000_1500':'1.000 € - 2.000 €','1500_2000':'1.000 € - 2.000 €',
 '2000_3000':'2.000 € - 3.000 €','3000_4000':'3.000 € - 4.000 €','4000_5000':'4.000 € - 5.000 €',
 '5000_6000':'5.000 € - 6.000 €','6000_7000':'6.000 € - 7.000 €',OVER_7000:'> 7.000 €',
 HOUSING_BENEFIT:'Ich beziehe Wohngeld',NOT_SPECIFIED:'Ich möchte keine Angabe machen'
};

function daysUntil(value:any){
 const raw=clean(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;
 const target=Date.parse(raw+'T12:00:00Z');if(!Number.isFinite(target))return null;
 return Math.ceil((target-Date.now())/86400000);
}
export function providerSalutation(provider:ApplicationProvider,value:any){
 const v=canonicalSalutation(value);if(!v)return null;
 if(provider==='immoscout'){
  if(v==='MR')return'MALE';if(v==='MS')return'FEMALE';if(v==='DIVERSE')return'DIVERS';
  return'NO_SALUTATION';
 }
 if(provider==='immowelt'){
  if(v==='MR')return'Herr';if(v==='MS')return'Frau';return'Neutral';
 }
 if(provider==='kleinanzeigen'){
  if(v==='MR')return'Herr';if(v==='MS')return'Frau';if(v==='DIVERSE')return'Divers';if(v==='COMPANY')return'Firma';
  return'Keine Angabe';
 }
 if(v==='MR')return'Herr';if(v==='MS')return'Frau';if(v==='DIVERSE')return'Divers';
 return'Keine Angabe';
}
export function providerHousehold(provider:ApplicationProvider,value:any){
 const v=canonicalHousehold(value);if(!v)return null;
 if(v==='NOT_SPECIFIED')return provider==='immowelt'?'Ich möchte keine Angabe machen':'Keine Angaben';
 return HOUSEHOLD_LABELS[v]||null;
}
export function providerEmployment(provider:ApplicationProvider,value:any){
 const v=canonicalEmployment(value);if(!v)return null;
 if(v==='NOT_SPECIFIED')return provider==='immowelt'?'Ich möchte keine Angabe machen':'Keine Angaben';
 if(provider==='immowelt'&&v==='DOCTORAL')return'Sonstiges';
 return EMPLOYMENT_LABELS[v]||null;
}
export function providerIncome(provider:ApplicationProvider,value:any){
 const v=canonicalIncome(value);if(!v)return null;
 if(provider==='immowelt'){
  if(v==='OVER_5000')return null; // legacy bucket is ambiguous for Immowelt's 5-6 / 6-7 / >7 bands
  return IMMOWELT_INCOME[v]||null;
 }
 return SCOUT_INCOME[v]||null;
}
export function providerMoveIn(provider:ApplicationProvider,profile:any){
 const v=canonicalMoveIn(profile?.move_in_preference);if(!v)return null;
 if(provider==='immowelt'){
  if(v==='IMMEDIATE')return'So bald wie möglich';
  if(v==='WITHIN_1_MONTH')return'<1 Monat';
  if(v==='WITHIN_3_MONTHS')return'<3 Monate';
  if(v==='AFTER_3_MONTHS')return'>3 Monate';
  if(v==='FLEXIBLE')return'Ich bin flexibel';
  if(v==='NOT_SPECIFIED')return'Ich möchte keine Angabe machen';
  if(v==='EXACT_DATE'){
   const d=daysUntil(profile?.move_in_date);if(d==null)return null;
   if(d<=0)return'So bald wie möglich';if(d<=31)return'<1 Monat';if(d<=92)return'<3 Monate';return'>3 Monate';
  }
 }
 if(v==='NOT_SPECIFIED')return'Keine Angaben';
 if(v==='FLEXIBLE')return'Flexibel';
 if(v==='IMMEDIATE')return'Sofort';
 if(v==='WITHIN_1_MONTH')return'Innerhalb 1 Monat';
 if(v==='WITHIN_3_MONTHS')return'Innerhalb 3 Monate';
 if(v==='AFTER_3_MONTHS')return'Später als 3 Monate';
 if(v==='EXACT_DATE')return clean(profile?.move_in_date)||null;
 return null;
}
export function providerEnumCandidates(provider:ApplicationProvider,semantic:string,profile:any){
 const key=String(semantic||'').toLowerCase();
 if(/salutation|anrede/.test(key)){
  const primary=providerSalutation(provider,profile?.salutation);
  const v=canonicalSalutation(profile?.salutation);
  return [...new Set([primary,v==='MR'?'MALE':null,v==='MS'?'FEMALE':null,v==='DIVERSE'?'DIVERS':null,['NEUTRAL','NOT_SPECIFIED'].includes(String(v))?'NOT_SPECIFIED':null].filter(Boolean))];
 }
 if(/household|haushalt|numberofpersons|personen/.test(key))return [providerHousehold(provider,profile?.household_type)].filter(Boolean);
 if(/employment|beruf|job|occupation/.test(key))return [providerEmployment(provider,profile?.employment_status)].filter(Boolean);
 if(/income|einkommen/.test(key))return [providerIncome(provider,profile?.income_range)].filter(Boolean);
 if(/move.?in|einzug/.test(key))return [providerMoveIn(provider,profile)].filter(Boolean);
 return [];
}
export function providerStaticMissing(provider:ApplicationProvider,profile:any,message?:string){
 const missing:string[]=[];
 const required:[string,any][]=[
  ['Vorname',profile?.first_name],['Nachname',profile?.last_name],['E-Mail-Adresse',profile?.email]
 ];
 if(provider==='immowelt'){
  required.unshift(['Anrede',providerSalutation('immowelt',profile?.salutation)]);
  required.push(
   ['Haushaltstyp',providerHousehold('immowelt',profile?.household_type)],
   ['Beschäftigungsstatus',providerEmployment('immowelt',profile?.employment_status)],
   ['Haushalts-Nettoeinkommen',providerIncome('immowelt',profile?.income_range)],
   ['Gewünschtes Einzugsdatum',providerMoveIn('immowelt',profile)]
  );
 }
 for(const [label,value] of required)if(!clean(value))missing.push(label);
 if(message!==undefined&&!clean(message))missing.push('Bewerbungstext');
 return [...new Set(missing)];
}
export function profileCanonicalSnapshot(profile:any){
 return{
  salutation:canonicalSalutation(profile?.salutation),
  employment_status:canonicalEmployment(profile?.employment_status),
  household_type:canonicalHousehold(profile?.household_type),
  income_range:canonicalIncome(profile?.income_range),
  move_in_preference:canonicalMoveIn(profile?.move_in_preference)
 };
}

export function profileAdapterSelfTest(){
 const checks={
  neutralToImmowelt:providerSalutation('immowelt','NEUTRAL')==='Neutral',
  neutralToImmoScout:providerSalutation('immoscout','NEUTRAL')==='NO_SALUTATION',
  mrToImmowelt:providerSalutation('immowelt','MR')==='Herr',
  mrToImmoScout:providerSalutation('immoscout','MR')==='MALE',
  noHouseholdToImmowelt:providerHousehold('immowelt','NOT_SPECIFIED')==='Ich möchte keine Angabe machen',
  doctoralToImmowelt:providerEmployment('immowelt','DOCTORAL')==='Sonstiges',
  housingBenefitToImmowelt:providerIncome('immowelt','HOUSING_BENEFIT')==='Ich beziehe Wohngeld',
  legacyOver5000RequiresRefinement:providerIncome('immowelt','OVER_5000')===null
 };
 return{ok:Object.values(checks).every(Boolean),checks};
}
