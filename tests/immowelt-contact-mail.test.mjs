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


test('ImmoWelt session refresh preserves Set-Cookie values across redirect hops', () => {
  const sessionStart = source.indexOf('async function immoweltFallbackSession');
  const sessionEnd = source.indexOf('async function sendImmoweltSessionFallback', sessionStart);
  const session = source.slice(sessionStart, sessionEnd);

  assert.match(session, /redirect:'manual'/);
  assert.match(session, /for\(let hop=0;hop<8;hop\+\+\)/);
  const merge = session.indexOf('cookies=mergeImmoweltSetCookies(cookies,response.headers,url);');
  const location = session.indexOf("const location=response.headers.get('location');");
  const follow = session.indexOf('url=new URL(location,url).href;');
  assert.ok(merge >= 0 && location > merge && follow > location);
  assert.match(session, /oauth\.access\.token/);
});


test('ImmoWelt session cookies use browser-style domain and path matching', () => {
  assert.match(source, /function immoweltCookieMatches/);
  assert.match(source, /hostOnly/);
  assert.match(source, /url\.pathname\.startsWith/);
  assert.match(source, /immoweltCookieHeader\(current\.cookies,endpoint\)/);
});

test('ImmoWelt retries authentication at most once after an auth rejection', () => {
  const fallbackStart = source.indexOf('async function sendImmoweltSessionFallback');
  const fallbackEnd = source.indexOf('export async function sendImmoweltApplication', fallbackStart);
  const fallback = source.slice(fallbackStart, fallbackEnd);
  assert.match(fallback, /authRetryAttempted=false/);
  assert.match(fallback, /immoweltFallbackSession\(db,String\(userId\|\|''\),forcedConnection,true\)/);
  assert.match(fallback, /attempt\.response\.status===401\|\|attempt\.response\.status===403/);
  assert.match(fallback, /attempt\.response\.status===401\)await markConnection/);
});


test('Immowelt fallback resolves profile options dynamically from listing context', () => {
  assert.match(source, /resolveImmoweltDynamicContactContext/);
  assert.match(source, /immoweltOptionPairs/);
  assert.match(source, /providerEnumCandidates\('immowelt'/);
  assert.match(source, /profileMappingMode:'dynamic-first'/);
  assert.match(source, /dynamicOptionsDetected/);
  assert.match(source, /unmappedOptionalFields/);
  assert.doesNotMatch(source, /if\(!codes\)return\{success:false,error:'session_fallback_profile_unmapped'/);
});

test('Immowelt fallback can omit unsupported optional profile fields instead of aborting', () => {
  const fallbackStart = source.indexOf('async function sendImmoweltSessionFallback');
  const fallbackEnd = source.indexOf('export async function sendImmoweltApplication', fallbackStart);
  const fallback = source.slice(fallbackStart, fallbackEnd);
  assert.match(fallback, /if\(values\.householdType\)/);
  assert.match(fallback, /if\(values\.workStatus\)/);
  assert.match(fallback, /if\(values\.netMonthlyIncome\)/);
  assert.match(fallback, /if\(values\.preferredMoveInDate\)/);
  assert.match(fallback, /profileMapped:true/);
});

test('Immowelt contact context can resolve a listing-specific classified id before submit', () => {
  assert.match(source, /immoweltClassifiedIdFromText/);
  assert.match(source, /classifiedIdSource/);
  assert.match(source, /page-matched-listing|page-unique|page-dominant/);
  const fallbackStart = source.indexOf('async function sendImmoweltSessionFallback');
  const fallbackEnd = source.indexOf('export async function sendImmoweltApplication', fallbackStart);
  const fallback = source.slice(fallbackStart, fallbackEnd);
  assert.match(fallback, /const context=await immoweltContactContext/);
  assert.match(fallback, /const classifiedId=String\(context\.classifiedId/);
});
