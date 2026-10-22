import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyRuntime} from '../scripts/check-runtime.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const path='supabase/functions/example/index.ts';
function fixture(text='export const ok=true;'){
 const sha256=hash(text);return {functions:[{slug:'example',entrypoint:path,files:[{path,sha256,deployed_sha256:sha256}]}]};
}
test('runtime gate accepts matching bundle and rejects code or recorded deployment drift',async()=>{
 const text='export const ok=true;',m=fixture(text);await verifyRuntime(m,async()=>text);
 await assert.rejects(verifyRuntime(m,async()=>text+'changed'),/Runtime drift/);
 m.functions[0].files[0].deployed_sha256='different';await assert.rejects(verifyRuntime(m,async()=>text),/Recorded deployment drift/);
});
test('runtime gate catches missing shared dependencies before deployment',async()=>{
 const text="import {fact} from '../shared/facts.ts';",m=fixture(text);
 await assert.rejects(verifyRuntime(m,async()=>text),/Missing bundled dependency/);
});
test('runtime gate rejects ambiguous duplicate functions',async()=>{
 const text='export const ok=true;',m=fixture(text);m.functions.push(structuredClone(m.functions[0]));
 await assert.rejects(verifyRuntime(m,async()=>text),/Duplicate function/);
});
test('runtime gate rejects temporary credential-bearing code imports',async()=>{
 const text="import 'https://raw.githubusercontent.com/example/repo/commit/runtime.ts?token=fixture-only';";
 await assert.rejects(verifyRuntime(fixture(text),async()=>text),/Credential-bearing runtime import/);
});

test('runtime gate accepts source/deployment divergence only when the live bundle archive proves it',async()=>{
 const source='export const version="repository";';
 const deployed='export const version="live";';
 const archivePath='docs/runtime-snapshot-2026-10-22/bundles/batch-01.json';
 const manifest={functions:[{
  slug:'example',version:2,verify_jwt:false,entrypoint:path,
  source_archive_file:archivePath,source_archive_status:'full_source',
  files:[{path,sha256:hash(source),deployed_sha256:hash(deployed)}]
 }]};
 const archive={functions:[{
  slug:'example',version:2,verify_jwt:false,artifact_sha256:'fixture-artifact',
  archive_status:'full_source',security_scan_flags:[],
  files:[{path:'functions/example/index.ts',content:deployed}]
 }]};
 const read=async file=>file===path?source:file===archivePath?JSON.stringify(archive):(()=>{throw Error('unexpected read '+file)})();
 const result=await verifyRuntime(manifest,read);
 assert.equal(result.sourceDeploymentDivergences.length,1);
 assert.equal(result.sourceDeploymentDivergences[0].slug,'example');
});

test('runtime gate rejects an archived deployed hash that does not match the recorded hash',async()=>{
 const source='export const version="repository";';
 const deployed='export const version="live";';
 const archivePath='docs/runtime-snapshot-2026-10-22/bundles/batch-01.json';
 const manifest={functions:[{
  slug:'example',version:2,verify_jwt:false,entrypoint:path,
  source_archive_file:archivePath,source_archive_status:'full_source',
  files:[{path,sha256:hash(source),deployed_sha256:hash('different deployed content')}]
 }]};
 const archive={functions:[{
  slug:'example',version:2,verify_jwt:false,artifact_sha256:'fixture-artifact',
  archive_status:'full_source',security_scan_flags:[],
  files:[{path:'functions/example/index.ts',content:deployed}]
 }]};
 const read=async file=>file===path?source:file===archivePath?JSON.stringify(archive):(()=>{throw Error('unexpected read '+file)})();
 await assert.rejects(verifyRuntime(manifest,read),/Recorded deployment drift/);
});
