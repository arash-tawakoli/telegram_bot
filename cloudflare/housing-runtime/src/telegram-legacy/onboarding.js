import { missingApplicantFields } from '../application-policy.js';

// One entry per guided question. Fields in one entry are answered in one step.
export const GUIDED_STEPS=[
 ['salutation'],['schufa_status'],['first_name'],['last_name'],['email'],['phone'],
 ['street'],['house_number'],['postcode'],['city'],
 ['household_type'],['employment_status'],['income_range'],['pets'],['move_in_preference']
];

export const QUESTIONS={
 salutation:{q:'Wie sollen Vermieter dich ansprechen?'},
 schufa_status:{q:'Hast du eine aktuelle SCHUFA-Auskunft (nicht älter als 3 Monate)?'},
 first_name:{q:'Wie lautet dein Vorname?',example:'Mara'},
 last_name:{q:'Und dein Nachname?',example:'Beispiel'},
 email:{q:'Wie lautet deine E-Mail-Adresse?',example:'name@beispiel.de'},
 phone:{q:'Unter welcher Nummer erreichen Vermieter dich?',example:'0176 1234567'},
 street:{q:'In welcher Straße wohnst du?',example:'Musterstraße'},
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
