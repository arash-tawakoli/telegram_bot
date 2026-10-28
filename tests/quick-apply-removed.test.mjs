import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

function files(dir){
  const out=[];
  for(const name of readdirSync(dir)){
    const p=join(dir,name);
    if(statSync(p).isDirectory()) out.push(...files(p));
    else if(/\.(?:ts|js)$/.test(name)) out.push(p);
  }
  return out;
}

test('runtime architecture has no legacy Schnellbewerbung/manual apply callback path',()=>{
  const root=fileURLToPath(new URL('../supabase/functions/',import.meta.url));
  const hits=[];
  for(const p of files(root)){
    const s=readFileSync(p,'utf8');
    if(/Schnellbewerbung/i.test(s)) hits.push([p,'Schnellbewerbung']);
    if(/enqueue_application_now/.test(s)) hits.push([p,'enqueue_application_now']);
    if(/callback_data\s*[:=][^\n]{0,80}['"`]apply:/.test(s)) hits.push([p,'apply callback']);
    if(/startsWith\(\s*['"]apply:/.test(s)) hits.push([p,'apply callback handler']);
  }
  assert.deepEqual(hits,[]);
});
