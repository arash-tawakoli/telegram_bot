import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const source=stripTypeScriptTypes(
  readFileSync(new URL('../supabase/functions/_shared/application-profile-adapters.ts',import.meta.url),'utf8')
).replace(/^export\s+/gm,'');
const scope={};
vm.runInNewContext(source,scope);

test('application message resolves repeated case-insensitive first-name placeholders at send time',()=>{
  const profile={
    first_name:'Arash',
    message_apartment:'Guten Tag [[Vorname]], auch [[ vorname ]] ist hier eingesetzt.'
  };
  const result=scope.applicationMessageFor(profile,{property_type:'Wohnung',title:'Wohnung'});
  assert.equal(result.field,'message_apartment');
  assert.equal(result.message,'Guten Tag Arash, auch Arash ist hier eingesetzt.');
});

test('application message leaves unrelated template text intact',()=>{
  const profile={first_name:'Mira',message_apartment:'Ich interessiere mich für die Wohnung.\nMit freundlichen Grüßen'};
  const result=scope.applicationMessageFor(profile,{property_type:'Wohnung',title:'Wohnung'});
  assert.equal(result.message,'Ich interessiere mich für die Wohnung.\nMit freundlichen Grüßen');
});

test('application message returns null when no template is configured',()=>{
  const result=scope.applicationMessageFor({first_name:'Mira'},{property_type:'Wohnung',title:'Wohnung'});
  assert.equal(result.field,'message_apartment');
  assert.equal(result.message,null);
});
