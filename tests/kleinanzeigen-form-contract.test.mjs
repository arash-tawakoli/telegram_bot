import assert from 'node:assert/strict';
import test from 'node:test';
import { providerFormCandidates, resolveProviderFormEnum } from '../supabase/functions/kleinanzeigen-application-worker/form-contract.mjs';

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
