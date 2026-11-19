import { missingApplicantFields } from '../application-policy.js';

// One entry per guided question. Fields in one entry are answered in one step.
export const GUIDED_STEPS=[
 ['first_name','last_name'],['email'],['phone'],['household_type'],['employment_status'],['income_range'],
 ['pets'],['move_in_preference'],['schufa_status'],['salutation'],['postcode'],['city'],['street','house_number']
];

export const QUESTIONS={
 salutation:{q:'Wie sollen Vermieter dich ansprechen?'},
 schufa_status:{q:'Hast du eine aktuelle SCHUFA-Auskunft (nicht älter als 3 Monate)?'},
 first_name:{q:'Wie lautet dein Vorname?',example:'Mara'},
 last_name:{q:'Und dein Nachname?',example:'Beispiel'},
 email:{q:'Wie lautet deine E-Mail-Adresse?',example:'name@beispiel.de'},
 phone:{q:'Unter welcher Nummer erreichen Vermieter dich?',example:'0176 1234567'},
 street:{q:'Wie lautet deine Straße mit Hausnummer?',example:'Musterstraße 12a'},
 house_number:{q:'Welche Hausnummer?',example:'12a'},
 postcode:{q:'Wie lautet deine PLZ?',example:'20095'},
 city:{q:'In welchem Ort wohnst du?',example:'Hamburg'},
 household_type:{q:'Wer zieht ein?'},
 employment_status:{q:'Was machst du beruflich?'},
 income_range:{q:'Wie hoch ist dein Haushalts-Nettoeinkommen pro Monat?'},
 pets:{q:'Hast du Haustiere?'},
 move_in_preference:{q:'Wann möchtest du einziehen?'},
 move_in_date:{q:'Welches Einzugsdatum möchtest du?',example:'2026-12-01'}
};

// application-policy reports text fields by label and enum fields by key.
const LABEL_FIELD={Vorname:'first_name',Nachname:'last_name','Straße':'street',Hausnummer:'house_number',Ort:'city',
 Haustiere:'pets','E-Mail-Adresse':'email',Telefonnummer:'phone',PLZ:'postcode',Einzugstermin:'move_in_date'};

const stepFields=step=>step.includes('move_in_preference')?[...step,'move_in_date']:step;

export function missingFieldSet(profile){
 return new Set(missingApplicantFields(profile||{}).map(label=>LABEL_FIELD[label]||label));
}

export function stepIndex(field){
 return GUIDED_STEPS.findIndex(step=>stepFields(step).includes(field));
}

// First unanswered question, so a half-filled profile resumes where it stopped.
export function nextQuestion(profile){
 const missing=missingFieldSet(profile);
 for(let index=0;index<GUIDED_STEPS.length;index++){
  const field=stepFields(GUIDED_STEPS[index]).find(name=>missing.has(name));
  if(field)return {index,total:GUIDED_STEPS.length,field};
 }
 return null;
}

export const previousField=field=>{const index=stepIndex(field);return index>0?GUIDED_STEPS[index-1][0]:null;};
export const progressBar=(done,total)=>'▓'.repeat(done)+'░'.repeat(Math.max(0,total-done));

// "Musterstraße 12a" -> street and house number; null when no number follows the street.
export function parseStreetLine(input){
 const match=String(input||'').trim().replace(/\s+/g,' ').match(/^(.*\S)\s+(\d+\s?[a-zA-Z]?(?:\s?[-–/]\s?\d+\s?[a-zA-Z]?)?)$/);
 return match?{street:match[1],house_number:match[2].replace(/\s+/g,'')}:null;
}

export const SELF_INPUT_LABEL='✍️ Selbst eingeben';
// Reply keyboard of the first question: Telegram only offers request_contact on reply keyboards.
export const contactKeyboard=()=>({
 keyboard:[[{text:'📱 Kontakt teilen',request_contact:true}],[{text:SELF_INPUT_LABEL}]],
 resize_keyboard:true,one_time_keyboard:true,input_field_placeholder:'Kontakt teilen oder selbst eingeben'
});

// Only the sender's own contact card counts; a forwarded foreign contact must not fill the profile.
export function parseContactShare(message){
 const contact=message?.contact;
 if(!contact||message?.from?.id==null||Number(contact.user_id)!==Number(message.from.id))return null;
 const digits=String(contact.phone_number||'').replace(/\D/g,'');
 const first_name=String(contact.first_name||'').trim().slice(0,120);
 if(!first_name||digits.length<7)return null;
 return {first_name,last_name:String(contact.last_name||'').trim().slice(0,120),phone:'+'+digits};
}

// Hamburg postcodes are 20xxx-22xxx. Anything else is asked, never guessed.
export const suggestCity=postcode=>/^2[0-2]\d{3}$/.test(String(postcode||'').trim())?'Hamburg':null;
