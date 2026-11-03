import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../supabase/functions/immoscout-send-canary/index.ts',import.meta.url),'utf8');
const cleanLine=source.split('\\n').find(line=>line.startsWith('const clean='));
const phoneLine=source.split('\\n').find(line=>line.startsWith('function phoneValue('));
if(!cleanLine||!phoneLine)throw new Error('phone normalizer source is missing');
const scope={};
vm.runInNewContext(cleanLine+'\\n'+phoneLine+'\\nglobalThis.phoneValue=phoneValue',scope);

test('existing production canary normalizes valid phone numbers and omits invalid optional numbers',()=>{
 for(const value of ['0171 1234567','0049 171 1234567','491711234567','+49 171 1234567'])assert.equal(scope.phoneValue(value),'+491711234567');
 for(const value of ['123','abc','+1234567890123456','1711234567'])assert.equal(scope.phoneValue(value),null);
});
