import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {previewOperations} from '../supabase/functions/notification-dispatcher/preview-delivery.ts';

test('listing preview stacks the four requested actions in exact order',()=>{
  const keyboard={inline_keyboard:[
    [{text:'Angebot',url:'https://example.com/listing/1'}],
    [{text:'Google Map',url:'https://www.google.com/maps/search/?api=1&query=Hamburg'}],
    [{text:'Auto-Bewerbung',callback_data:'platforms'}],
    [{text:'Speichern',callback_data:'save:123'}],
  ]};
  const op=previewOperations([],'📍 Adresse: Hamburg',keyboard)[0];
  const rows=op.body.reply_markup.inline_keyboard;
  assert.deepEqual(rows.map(row=>row.map(button=>button.text)),[
    ['Angebot'],['Speichern'],['Google Map'],['Auto-Bewerbung'],
  ]);
  assert.equal(rows[3][0].callback_data,'platforms');
});

test('dispatcher no longer creates a manual quick-application action',()=>{
  const dispatcher=readFileSync(new URL('../supabase/functions/notification-dispatcher/index.ts',import.meta.url),'utf8');
  const delivery=readFileSync(new URL('../supabase/functions/notification-dispatcher/preview-delivery.ts',import.meta.url),'utf8');
  assert.doesNotMatch(dispatcher,/quickApplyButton|application-message\.js|Schnellbewerbung|callback_data:\s*[`'"]apply:/);
  assert.doesNotMatch(delivery,/startsWith\(['"]apply:|Schnellbewerbung/);
  assert.match(dispatcher,/callback_data:"platforms"/);
});

test('legacy one-click application modules and callback handlers are removed',()=>{
  assert.equal(existsSync(new URL('../supabase/functions/telegram-ui/application.js',import.meta.url)),false);
  assert.equal(existsSync(new URL('../supabase/functions/telegram-ui/application-message.js',import.meta.url)),false);
  const handlers=readFileSync(new URL('../supabase/functions/telegram-ui/handlers.js',import.meta.url),'utf8');
  const gateway=readFileSync(new URL('../supabase/functions/telegram-gateway/auto-apply.ts',import.meta.url),'utf8');
  assert.doesNotMatch(handlers,/quickApplication|enqueue_application_now|startsWith\(['"]apply:/);
  assert.doesNotMatch(gateway,/handleApply|enqueue_application_now|startsWith\(['"]apply:|callback_data.*apply:/);
  assert.match(gateway,/data==='platforms'\|\|data\.startsWith\('platforms:'\)/);
});

test('preview labels use the requested German button names',()=>{
  const labels=readFileSync(new URL('../supabase/functions/notification-dispatcher/labels.ts',import.meta.url),'utf8');
  assert.match(labels,/offer: "Angebot"/);
  assert.match(labels,/save: "Speichern"/);
  assert.match(labels,/maps: "Google Map"/);
  assert.match(labels,/auto_apply: "Auto-Bewerbung"/);
  const handlers=readFileSync(new URL('../supabase/functions/telegram-ui/handlers.js',import.meta.url),'utf8');
  assert.doesNotMatch(handlers,/❤️ Speichern|❤️ Gespeichert/);
  assert.match(handlers,/savedState \? "Gespeichert" : "Speichern"/);
});
