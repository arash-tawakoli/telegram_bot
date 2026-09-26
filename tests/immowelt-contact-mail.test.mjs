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
