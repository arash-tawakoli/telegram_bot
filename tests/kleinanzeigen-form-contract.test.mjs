import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { providerFormCandidates, resolveProviderFormEnum, summarizeFormOptions } from '../supabase/functions/kleinanzeigen-application-worker/form-contract.mjs';

test('Kleinanzeigen salutation maps only to a live allowed value or matching form label', () => {
  const value = providerFormCandidates('salutation', 'MR');
  assert.equal(resolveProviderFormEnum({ enum: ['Herr', 'Frau'] }, value, 'salutation'), 'Herr');
  assert.equal(resolveProviderFormEnum({ enum: ['MALE', 'FEMALE'] }, value, 'salutation'), 'MALE');
  assert.equal(resolveProviderFormEnum({ enum: ['MR', 'MS'] }, value, 'salutation'), 'MR');
  assert.equal(resolveProviderFormEnum({ enum: ['1', '2'], enumNames: ['Frau', 'Divers'] }, value, 'salutation'), undefined);
  assert.equal(resolveProviderFormEnum({ enum: ['1', '2'], oneOf: [{ const: '1', title: 'Herr' }, { const: '2', title: 'Frau' }] }, value, 'salutation'), '1');
});

test('Kleinanzeigen income range maps by exact provider range and rejects mismatched bands', () => {
  const value = providerFormCandidates('income', '3000_4000', '3.000€ - 4.000€');
  assert.equal(resolveProviderFormEnum({ enum: ['3000_4000', '4000_5000'] }, value, 'income'), '3000_4000');
  assert.equal(resolveProviderFormEnum({ enum: ['INCOME_3000_4000', 'INCOME_4000_5000'] }, value, 'income'), 'INCOME_3000_4000');
  assert.equal(resolveProviderFormEnum({ enum: ['BAND_A', 'BAND_B'], enumNames: ['3.000 € – 4.000 €', '4.000 € – 5.000 €'] }, value, 'income'), 'BAND_A');
  assert.equal(resolveProviderFormEnum({ enum: ['2.000€ - 3.000€'] }, value, 'income'), undefined);
});


test('Kleinanzeigen profile income buckets map to the exact live XCF enum values', () => {
  const profileToProvider = {
    UNDER_500: 'LESS_THAN_500_EUR',
    '500_1000': 'EUR_500_TO_1000',
    '1000_1500': 'EUR_1000_TO_1500',
    '1500_2000': 'EUR_1500_TO_2000',
    '2000_3000': 'EUR_2000_TO_3000',
    '3000_4000': 'EUR_3000_TO_4000',
    '4000_5000': 'EUR_4000_TO_5000',
    OVER_5000: 'MORE_THAN_5000_EUR',
  };
  const labels = ['Unter 500€', '500€ - 1.000€', '1.000€ - 1.500€', '1.500€ - 2.000€', '2.000€ - 3.000€', '3.000€ - 4.000€', '4.000€ - 5.000€', 'Über 5.000€'];
  const values = Object.values(profileToProvider);
  const prop = { type: 'string', enum: values, oneOf: values.map((value, i) => ({ value, label: labels[i] })) };
  const display = {
    UNDER_500: 'Unter 500€',
    '500_1000': '500€ - 1.000€',
    '1000_1500': '1.000€ - 1.500€',
    '1500_2000': '1.500€ - 2.000€',
    '2000_3000': '2.000€ - 3.000€',
    '3000_4000': '3.000€ - 4.000€',
    '4000_5000': '4.000€ - 5.000€',
    OVER_5000: 'Über 5000€',
  };
  for (const [profileRange, providerValue] of Object.entries(profileToProvider)) {
    const raw = providerFormCandidates('income', profileRange, display[profileRange]);
    assert.equal(resolveProviderFormEnum(prop, raw, 'income'), providerValue);
  }
  const worker = readFileSync(new URL('../supabase/functions/kleinanzeigen-application-worker/index.ts', import.meta.url), 'utf8');
  assert.ok(worker.includes("else if(/income|einkommen/i.test(k))v=pval(k,p,a,locationId,prop);"));
});

test('read-only form diagnostics expose schema choices and omit profile values', () => {
  const summary = summarizeFormOptions(
    { type: 'string', enum: ['MALE', 'FEMALE'], enumNames: ['Herr', 'Frau'] },
    { elements: [{ type: 'Control', scope: '#/properties/salutation', options: { enumOptions: [{ value: 'MALE', label: 'Herr' }] } }] },
    'salutation',
  );
  assert.deepEqual(summary.enum, [{ value: 'MALE', label: 'Herr' }, { value: 'FEMALE', label: 'Frau' }]);
  assert.deepEqual(summary.uiOptions, [{ value: 'MALE', label: 'Herr' }]);
  assert.ok(!JSON.stringify(summary).includes('profile'));
});


test('diagnostic-only worker path returns before authorization and send', () => {
  const worker = readFileSync(new URL('../supabase/functions/kleinanzeigen-application-worker/index.ts', import.meta.url), 'utf8');
  const guard = worker.indexOf("if(app.provider_state?.diagnostic_only===true)");
  const diagnosticReturn = worker.indexOf("return{status:'manual_required',provider:'kleinanzeigen',diagnosticOnly:true", guard);
  const authorize = worker.indexOf("const authorize=async()=>{", guard);
  const send = worker.indexOf("const result:any=await send({...x,authorize", guard);
  assert.ok(guard >= 0 && diagnosticReturn > guard && diagnosticReturn < authorize && diagnosticReturn < send);
});
