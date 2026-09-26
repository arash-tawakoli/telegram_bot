import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-26T22:30:00.000Z'])); }
  static now() { return new Date('2026-09-26T22:30:00.000Z').getTime(); }
}

function loadTs(path, exports, scope = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace(/^export\s+/gm, '');
  return vm.runInNewContext(stripTypeScriptTypes(source) + ';({' + exports + '})', scope);
}

const adapterNames = [
  'canonicalSalutation', 'canonicalEmployment', 'canonicalHousehold', 'canonicalIncome',
  'canonicalMoveIn', 'canonicalSchufa', 'providerSalutation', 'providerHousehold',
  'providerEmployment', 'providerIncome', 'providerPets', 'providerSchufa', 'providerMoveIn',
  'providerEnumCandidates', 'providerStaticMissing', 'profileCanonicalSnapshot',
  'applicationMessageField', 'applicationMessageFor', 'profileAdapterSelfTest'
];
const adapters = loadTs(
  '../supabase/functions/_shared/application-profile-adapters.ts',
  adapterNames.join(','),
  {Date: FixedDate, Intl}
);
const adapterDeps = Object.fromEntries(adapterNames.map(name => [name, adapters[name]]));
const scout = loadTs(
  '../supabase/functions/application-worker/providers/immoscout.ts',
  'prepareImmoScoutForm',
  {...adapterDeps, TextEncoder, Date: FixedDate}
);
const kleinanzeigen = loadTs(
  '../supabase/functions/application-worker/providers/kleinanzeigen.ts',
  'prepareRequiredForm',
  {...adapterDeps, TextEncoder, Date: FixedDate, btoa}
);

test('salutation values adapt to each portal and unsupported ImmoScout choices are omitted', () => {
  const expected = [
    ['MR', 'Herr', 'Herr', 'MALE'],
    ['MS', 'Frau', 'Frau', 'FEMALE'],
    ['COMPANY', 'Neutral', 'Keine Angabe', 'COMPANY'],
    ['NEUTRAL', 'Neutral', 'Keine Angabe', null],
    ['DIVERSE', 'Neutral', 'Divers', null],
    ['NOT_SPECIFIED', 'Neutral', 'Keine Angabe', null]
  ];
  for (const [input, immowelt, klein, scoutValue] of expected) {
    assert.equal(adapters.providerSalutation('immowelt', input), immowelt);
    assert.equal(adapters.providerSalutation('kleinanzeigen', input), klein);
    assert.equal(adapters.providerSalutation('immoscout', input), scoutValue);
    assert.equal(adapters.providerSalutation('immomio', input), null);
  }
  assert.equal(adapters.providerSalutation('immowelt', 'Firma'), 'Neutral');
  assert.equal(adapters.providerSalutation('kleinanzeigen', 'Divers'), 'Divers');
});

test('household, employment and income values use each portal’s available labels', () => {
  assert.equal(adapters.providerHousehold('kleinanzeigen', 'TWO_ADULTS'), 'Zweipersonenhaushalt');
  assert.equal(adapters.providerHousehold('immowelt', 'TWO_ADULTS'), 'Zwei Erwachsene');
  assert.equal(adapters.providerHousehold('immoscout', 'NOT_SPECIFIED'), null);
  assert.equal(adapters.providerHousehold('immowelt', 'NOT_SPECIFIED'), 'Ich möchte keine Angabe machen');
  assert.equal(adapters.providerHousehold('kleinanzeigen', 'NOT_SPECIFIED'), 'Keine Angabe');

  assert.equal(adapters.providerEmployment('kleinanzeigen', 'WORKER'), 'Sonstiges');
  assert.equal(adapters.providerEmployment('kleinanzeigen', 'STUDENT'), 'Student(in)');
  assert.equal(adapters.providerEmployment('kleinanzeigen', 'CIVIL_SERVANT'), 'Beamte(r/in)');
  assert.equal(adapters.providerEmployment('immowelt', 'DOCTORAL'), 'Sonstiges');
  assert.equal(adapters.providerEmployment('immoscout', 'STUDENT'), 'Studierende(r)');

  assert.equal(adapters.providerIncome('kleinanzeigen', '500_1000'), '500€ - 1.000€');
  assert.equal(adapters.providerIncome('immowelt', '500_1000'), '< €1.000');
  assert.equal(adapters.providerIncome('immowelt', '1500_2000'), '1.000 € - 2.000 €');
  assert.equal(adapters.providerIncome('immowelt', 'OVER_5000'), 'Ich möchte keine Angabe machen');
  assert.equal(adapters.providerIncome('immoscout', '6000_7000'), 'Über 5000€');
});

test('Schufa and pet values are translated where the contact form supports them', () => {
  assert.equal(adapters.providerSchufa('kleinanzeigen', 'PRESENT_RECENT'), 'Vorhanden (< 3 Monate)');
  assert.equal(adapters.providerSchufa('kleinanzeigen', 'AVAILABLE'), 'Vorhanden (< 3 Monate)');
  assert.equal(adapters.providerSchufa('kleinanzeigen', 'NOT_AVAILABLE'), 'Nicht vorhanden');
  assert.equal(adapters.providerSchufa('immoscout', 'PRESENT_RECENT'), null);
  assert.equal(adapters.providerPets('kleinanzeigen', 'Hund'), 'Ja');
  assert.equal(adapters.providerPets('kleinanzeigen', 'Hamster'), null);
  assert.equal(adapters.providerPets('immowelt', 'Hamster'), 'Nein');
  assert.equal(adapters.providerPets('immoscout', 'Hund'), 'Ja');
});

test('static readiness follows each portal form and treats optional profile values as optional', () => {
  const identity = {first_name: 'Alex', last_name: 'Example'};
  const immowelt = {
    ...identity,
    email: 'alex@example.com',
    street: 'Musterstraße',
    house_number: '4',
    postcode: '20095',
    city: 'Hamburg',
    salutation: null,
    household_type: null,
    employment_status: null,
    income_range: null,
    pets: null,
    move_in_preference: null,
    schufa_status: null
  };
  assert.deepEqual([...adapters.providerStaticMissing('immowelt', immowelt, 'Immowelt message')], []);
  assert.deepEqual(
    [...adapters.providerStaticMissing('immowelt', {...immowelt, email: ''}, 'Message')],
    ['E-Mail-Adresse']
  );
  assert.deepEqual(
    [...adapters.providerStaticMissing('immowelt', {...immowelt, street: '', house_number: '', postcode: ''}, 'Message')],
    ['Straße', 'Hausnummer', 'PLZ']
  );

  const kleinanzeigen = {
    ...identity,
    salutation: 'NOT_SPECIFIED',
    street: 'Musterstraße',
    house_number: '4',
    postcode: '20095',
    city: 'Hamburg',
    schufa_status: 'NOT_SPECIFIED',
    household_type: 'NOT_SPECIFIED',
    employment_status: 'NOT_SPECIFIED',
    income_range: 'NOT_SPECIFIED',
    move_in_preference: 'NOT_SPECIFIED'
  };
  assert.deepEqual([...adapters.providerStaticMissing('kleinanzeigen', kleinanzeigen, 'Kleinanzeigen message')], []);
  assert.deepEqual(
    [...adapters.providerStaticMissing('kleinanzeigen', {...kleinanzeigen, email: '', phone: '', pets: ''}, 'Message')],
    []
  );
  assert.deepEqual(
    [...adapters.providerStaticMissing('kleinanzeigen', {...kleinanzeigen, city: '', income_range: null}, 'Message')],
    ['Ort', 'Haushalts-Nettoeinkommen']
  );

  const scout = {
    ...identity,
    salutation: 'NEUTRAL',
    household_type: 'NOT_SPECIFIED',
    employment_status: 'NOT_SPECIFIED',
    income_range: 'NOT_SPECIFIED',
    move_in_preference: 'NOT_SPECIFIED'
  };
  assert.deepEqual([...adapters.providerStaticMissing('immoscout', scout, 'ImmoScout message')], []);
  assert.deepEqual(
    [...adapters.providerStaticMissing('immoscout', {...scout, email: '', street: '', phone: ''}, 'Message')],
    []
  );
  assert.deepEqual([...adapters.providerStaticMissing('immoscout', identity, '')], [
    'Anrede', 'Haushaltstyp', 'Beschäftigungsstatus', 'Haushalts-Nettoeinkommen', 'Einzugsdatum', 'Bewerbungstext'
  ]);
  assert.ok([...adapters.providerStaticMissing('kleinanzeigen', {
    ...kleinanzeigen,
    move_in_preference: 'EXACT_DATE',
    move_in_date: '2026-02-30'
  }, 'Template')].includes('Gewünschtes Einzugsdatum'));
});

test('exact move-in dates are handled as portal choices using the Berlin calendar day', () => {
  const exact = date => ({move_in_preference: 'EXACT_DATE', move_in_date: date});
  assert.equal(adapters.providerMoveIn('immowelt', exact('2026-10-01')), '<1 Monat');
  assert.equal(adapters.providerMoveIn('immowelt', exact('2026-10-27')), '<1 Monat');
  assert.equal(adapters.providerMoveIn('immowelt', exact('2026-10-28')), '<3 Monate');
  assert.equal(adapters.providerMoveIn('immowelt', exact('2026-12-26')), '<3 Monate');
  assert.equal(adapters.providerMoveIn('immowelt', exact('2026-12-27')), '>3 Monate');
  assert.equal(adapters.providerMoveIn('kleinanzeigen', exact('2026-10-01')), 'Keine Angabe');
  assert.equal(adapters.providerMoveIn('immoscout', exact('2026-10-01')), '2026-10-01');
});

test('the four category-specific messages are routed without a generic fallback', () => {
  const templates = {
    message_swap: 'Swap text',
    message_temporary_wg: 'Temporary and WG text',
    message_house: 'House text',
    message_apartment: 'Apartment text',
    default_message: 'Do not send this generic text'
  };
  const cases = [
    [{property_type: 'Tauschwohnung'}, 'message_swap', 'Swap text'],
    [{property_type: 'Auf Zeit'}, 'message_temporary_wg', 'Temporary and WG text'],
    [{property_type: 'WG-Zimmer'}, 'message_temporary_wg', 'Temporary and WG text'],
    [{property_type: 'Haus'}, 'message_house', 'House text'],
    [{property_type: 'Wohnung'}, 'message_apartment', 'Apartment text']
  ];
  for (const [listing, field, message] of cases) {
    const chosen = adapters.applicationMessageFor(templates, listing);
    assert.equal(chosen.field, field);
    assert.equal(chosen.message, message);
  }
  assert.equal(
    adapters.applicationMessageFor({message_apartment: '  First line  \r\nSecond  line  '}, {property_type: 'Wohnung'}).message,
    'First line\nSecond line'
  );
  assert.equal(adapters.applicationMessageFor({default_message: 'generic'}, {property_type: 'Wohnung'}).message, null);
});

test('ImmoScout omits explicit no-answer salutation but still sends the category message', () => {
  const profile = {
    salutation: 'NEUTRAL',
    first_name: 'Alex',
    last_name: 'Example',
    email: 'alex@example.com',
    street: 'Musterstraße',
    house_number: '4',
    postcode: '20095',
    city: 'Hamburg'
  };
  const config = {
    salutationField: {required: true},
    firstnameField: {required: true},
    lastnameField: {required: true},
    emailAddressField: {required: true},
    addressField: {required: true},
    messageField: {required: false}
  };
  const result = scout.prepareImmoScoutForm(config, profile, 'The selected apartment template');
  assert.equal(result.missing.length, 0);
  assert.equal(Object.hasOwn(result.form, 'salutation'), false);
  assert.equal(result.form.firstname, 'Alex');
  assert.equal(result.form.emailAddress, 'alex@example.com');
  assert.equal(result.form.address.street, 'Musterstraße');
  assert.equal(result.form.message, 'The selected apartment template');
  assert.equal(result.mapped.find(field => field.configKey === 'salutationField').omitted, true);
});

test('ImmoScout omits explicitly unanswered mapped fields without treating them as missing', () => {
  const profile = {
    salutation: 'NOT_SPECIFIED',
    first_name: 'Alex',
    last_name: 'Example',
    email: 'alex@example.com',
    household_type: 'NOT_SPECIFIED',
    employment_status: 'NOT_SPECIFIED',
    income_range: 'NOT_SPECIFIED',
    move_in_preference: 'NOT_SPECIFIED'
  };
  const config = {
    salutationField: {required: true},
    numberOfPersonsField: {required: true},
    employmentRelationshipField: {required: true},
    incomeField: {required: true},
    moveInDateField: {required: true},
    messageField: {required: false}
  };
  const result = scout.prepareImmoScoutForm(config, profile, 'The selected category template');
  assert.equal(result.missing.length, 0);
  for (const key of ['salutation', 'numberOfPersons', 'employmentRelationship', 'income', 'moveInDate']) {
    assert.equal(Object.hasOwn(result.form, key), false);
  }
  assert.equal(result.form.message, 'The selected category template');
});

test('Kleinanzeigen maps required contact fields and includes an optional message field', () => {
  const form = {
    schema: {
      required: [
        'contactFirstName', 'contactLastName', 'email', 'salutation',
        'currentSchufaInformation', 'employment', 'income', 'household',
        'pets', 'moveIn', 'streetNumber'
      ],
      properties: {
        contactFirstName: {type: 'string'},
        contactLastName: {type: 'string'},
        email: {type: 'string'},
        salutation: {type: 'string', enum: ['n', 'f', 'm', 'd'], enumNames: ['Keine Angabe', 'Frau', 'Herr', 'Divers']},
        currentSchufaInformation: {type: 'string', enum: ['n', 'p', 'x'], enumNames: ['Keine Angabe', 'Vorhanden (< 3 Monate)', 'Nicht vorhanden']},
        employment: {type: 'string', enum: ['other', 'employee'], enumNames: ['Sonstiges', 'Angestellte(r)']},
        income: {type: 'string', enum: ['low', 'middle'], enumNames: ['500€ - 1.000€', '1.000€ - 1.500€']},
        household: {type: 'string', enum: ['single', 'pair'], enumNames: ['Einpersonenhaushalt', 'Zweipersonenhaushalt']},
        pets: {type: 'string', enum: ['na', 'yes', 'no'], enumNames: ['Keine Angaben', 'Ja', 'Nein']},
        moveIn: {type: 'string', enum: ['unknown', 'flexible', 'soon'], enumNames: ['Keine Angabe', 'Flexibel', 'Sofort']},
        streetNumber: {type: 'string'},
        message: {type: 'string'}
      }
    },
    uiSchema: {elements: []},
    data: {}
  };
  const profile = {
    first_name: 'Alex',
    last_name: 'Example',
    email: 'alex@example.com',
    salutation: 'DIVERSE',
    schufa_status: 'PRESENT_RECENT',
    employment_status: 'WORKER',
    income_range: '500_1000',
    household_type: 'TWO_ADULTS',
    pets: 'Hund',
    move_in_preference: 'EXACT_DATE',
    move_in_date: '2026-10-01',
    street: 'Musterstraße',
    house_number: '4'
  };
  const result = kleinanzeigen.prepareRequiredForm(form, profile, 'Template message');
  assert.equal(result.missing.length, 0);
  assert.equal(result.unsupported.length, 0);
  assert.equal(result.payload.contactFirstName, 'Alex');
  assert.equal(result.payload.contactLastName, 'Example');
  assert.equal(result.payload.salutation, 'd');
  assert.equal(result.payload.currentSchufaInformation, 'p');
  assert.equal(result.payload.employment, 'other');
  assert.equal(result.payload.income, 'low');
  assert.equal(result.payload.household, 'pair');
  assert.equal(result.payload.pets, 'yes');
  assert.equal(result.payload.moveIn, 'unknown');
  assert.equal(result.payload.streetNumber, 'Musterstraße 4');
  assert.equal(result.payload.message, 'Template message');
});

test('Kleinanzeigen fails closed if the contact form has no message field', () => {
  const result = kleinanzeigen.prepareRequiredForm({
    schema: {required: ['contactFirstName'], properties: {contactFirstName: {type: 'string'}}},
    uiSchema: {elements: []},
    data: {}
  }, {first_name: 'Alex'}, 'Template message');
  assert.equal(result.unsupported.length, 1);
  assert.equal(result.unsupported[0].id, 'message');
  assert.equal(result.unsupported[0].label, 'Nachricht');
  assert.equal(result.unsupported[0].type, 'string');
});

test('ImmoMio has no application-stage profile mapping or message requirement', () => {
  assert.equal(adapters.providerStaticMissing('immomio', {}, 'ignored message').length, 0);
  assert.equal(adapters.providerEnumCandidates('immomio', 'salutation', {salutation: 'MR'}).length, 0);
  assert.equal(adapters.providerSalutation('immomio', 'MR'), null);
  assert.equal(adapters.providerHousehold('immomio', 'SINGLE'), null);
  assert.equal(adapters.providerEmployment('immomio', 'EMPLOYEE'), null);
  assert.equal(adapters.providerIncome('immomio', 'UNDER_500'), null);
  assert.equal(adapters.providerPets('immomio', 'Hund'), null);
  assert.equal(adapters.providerMoveIn('immomio', {move_in_preference: 'FLEXIBLE'}), null);
  assert.equal(adapters.profileAdapterSelfTest().ok, true);
});
