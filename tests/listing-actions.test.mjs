import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {quickApplyButton,applicationTarget} from '../supabase/functions/telegram-ui/application-message.js';

const id='123e4567-e89b-12d3-a456-426614174000';

test('quick apply action is present for every active listing source',()=>{
  assert.deepEqual(quickApplyButton({id,is_active:true,source_id:16,canonical_url:'https://example.com/listing/1'}),{
    text:'⚡ Schnellbewerbung',callback_data:`apply:${id}`,
  });
  assert.equal(quickApplyButton({id,is_active:false,source_id:16,canonical_url:'https://example.com/listing/1'}),null);
});

test('automatic application targets remain restricted to supported portals',()=>{
  assert.equal(applicationTarget({source_id:16,canonical_url:'https://example.com/listing/1'}),null);
  assert.equal(applicationTarget({source_id:1,canonical_url:'https://www.immobilienscout24.de/expose/123'}).platform,'ImmoScout24');
});

test('delivery normalizer guarantees maps and the requested action order',()=>{
  const source=readFileSync(new URL('../supabase/functions/notification-dispatcher/preview-delivery.ts',import.meta.url),'utf8');
  assert.match(source,/Google Maps/);
  assert.match(source,/inline_keyboard:\[offer,maps,save,\.\.\.\(applyRow\?\[applyRow\]:\[\]\)/);
});

test('save labels use heart state',()=>{
  const labels=readFileSync(new URL('../supabase/functions/notification-dispatcher/labels.ts',import.meta.url),'utf8');
  const handlers=readFileSync(new URL('../supabase/functions/telegram-ui/handlers.js',import.meta.url),'utf8');
  assert.match(labels,/❤️ Speichern/);
  assert.match(labels,/❤️ Gespeichert/);
  assert.match(handlers,/❤️ Speichern/);
  assert.match(handlers,/❤️ Gespeichert/);
});
