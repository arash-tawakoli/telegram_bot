import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../supabase/functions/application-worker/providers/immowelt.ts', import.meta.url), 'utf8');
const sendStart = source.indexOf('export async function sendImmoweltApplication(input:any)');
const requestStart = source.indexOf('const soap=', sendStart);
const requestEnd = source.indexOf(';\n const authorized=await authorize();', requestStart);
const request = source.slice(requestStart, requestEnd + 1);

test('ImmoWelt SendContactMail follows the documented ContactMailRequest sequence', () => {
  assert.ok(sendStart >= 0 && requestStart > sendStart && requestEnd > requestStart);
  const fields = ['<LinkToDetail>', '<EstateGuid>', '<Enquirer>', '<Message>', '<Domain>', '<SubjectType>'];
  const positions = fields.map(field => request.indexOf(field));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.ok(request.includes('<LinkToDetail>${xml(url)}</LinkToDetail>'));
  assert.ok(request.includes('<EMail>${xml(email)}</EMail>'));
  assert.doesNotMatch(request, /<ExposeKey>|<OnlyUseLinkToDetail>|<OnlyMailToCustomer>/);
});


test('ImmoWelt explicit SOAP rejection falls back once to the authenticated contact-request service', () => {
  const explicitFalse = source.indexOf('const explicitFalse=');
  const guardedFallback = source.indexOf('if(explicitFalse)', explicitFalse);
  const fallbackCall = source.indexOf('await sendImmoweltSessionFallback', guardedFallback);
  const ambiguousFailure = source.indexOf("error:'submission_unconfirmed'", fallbackCall);

  assert.ok(explicitFalse >= 0 && guardedFallback > explicitFalse && fallbackCall > guardedFallback);
  assert.ok(ambiguousFailure > fallbackCall);
  assert.match(source, /https:\/\/www\.immowelt\.de\/contact-request-service\/contacting/);
  assert.match(source, /https:\/\/signin\.immowelt\.de\/refresh/);
  assert.match(source, /oauth\.access\.token/);
  assert.match(source, /authorization:'Bearer '/);
  assert.match(source, /confirmation:'immowelt_contact_request_service'/);
});
