import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyArchivedRuntime} from '../scripts/check-runtime.mjs';

const bundlePath='docs/runtime-snapshot-2026-10-21/bundles/batch-23.json';
const bundle={functions:[{slug:'archived-probe',version:2,verify_jwt:false,artifact_sha256:'abc',archive_status:'full_source',security_scan_flags:[],files:[{path:'index.ts',content:'export default {};'}]}]};
const entry={slug:'archived-probe',version:2,verify_jwt:false,artifact_sha256:'abc',source_file_count:1,archive_file:bundlePath,archive_status:'full_source',security_scan_flags:[]};
const runtime={functions:[{slug:'managed'}],archived_functions:[entry],live_inventory:{live_function_count:2}};

test('runtime archive accepts matching archived-only bundle metadata',async()=>{
 const result=await verifyArchivedRuntime(runtime,async path=>{assert.equal(path,bundlePath);return JSON.stringify(bundle)});
 assert.deepEqual(result,{archivedFunctions:1,totalFunctions:2});
});

test('runtime archive rejects version drift and missing source files',async()=>{
 const wrong={...bundle,functions:[{...bundle.functions[0],version:3}]};
 await assert.rejects(verifyArchivedRuntime(runtime,async()=>JSON.stringify(wrong)),/Archived version drift/);
 const empty={...bundle,functions:[{...bundle.functions[0],files:[]}]};
 await assert.rejects(verifyArchivedRuntime(runtime,async()=>JSON.stringify(empty)),/source file count drift/);
});

test('runtime archive rejects duplicate slugs and incomplete secret-reviewed bundles',async()=>{
 await assert.rejects(verifyArchivedRuntime({...runtime,functions:[{slug:'archived-probe'}]},async()=>JSON.stringify(bundle)),/Duplicate or invalid archived function/);
 const redacted={...bundle,functions:[{...bundle.functions[0],archive_status:'redacted_potential_secret'}]};
 await assert.rejects(verifyArchivedRuntime(runtime,async()=>JSON.stringify(redacted)),/incomplete or redacted/);
});
