import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFinkenInventory} from '../supabase/functions/source-worker/finken-inventory.ts';

test('Finkenwärder accepts only Hamburg apartments with tenant.immomio application links',()=>{
 const result=parseFinkenInventory(JSON.stringify([
  {id:'ok',city:'Hamburg',postalcode:'21129',numberOfRooms:2,street:'Teststraße',houseNumber:'1',baseRent:'700',overallSpace:'55',applicationLink:'https://tenant.immomio.com/de/apply/01234567-89ab-4cde-8123-456789abcdef'},
  {id:'outside',city:'Seevetal',postalcode:'21217',numberOfRooms:2,street:'Teststraße',houseNumber:'2',applicationLink:'https://tenant.immomio.com/de/apply/01234567-89ab-4cde-8123-456789abcdef'}
 ]));
 assert.equal(result.enumerated,2);assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].key,'ok');
});

test('Finkenwärder rejects non-tenant application links',()=>{
 assert.throws(()=>parseFinkenInventory(JSON.stringify([{id:'bad',city:'Hamburg',postalcode:'21129',numberOfRooms:2,applicationLink:'https://example.com/apply/1'}])),/application identity/);
});
