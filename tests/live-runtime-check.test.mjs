import test from 'node:test';
import assert from 'node:assert/strict';
import {compareLiveRuntime} from '../scripts/check-live-runtime.mjs';

const manifest={
 functions:[{slug:'source-worker',version:106,verify_jwt:false,observed_live_version:106,observed_live_verify_jwt:false}],
 archived_functions:[{slug:'diagnostic-probe',version:2,verify_jwt:true}]
};
test('live runtime comparison accepts exact slug, version and JWT parity',()=>{
 const live=[{slug:'source-worker',version:106,verify_jwt:false},{slug:'diagnostic-probe',version:2,verify_jwt:true}];
 assert.deepEqual(compareLiveRuntime(live,manifest),{expected:2,actual:2,matched:2});
});
test('live runtime comparison rejects missing, extra and changed deployments',()=>{
 assert.throws(()=>compareLiveRuntime([{slug:'source-worker',version:106,verify_jwt:false}],manifest),/missing=diagnostic-probe/);
 assert.throws(()=>compareLiveRuntime([{slug:'source-worker',version:106,verify_jwt:false},{slug:'diagnostic-probe',version:2,verify_jwt:true},{slug:'unexpected',version:1,verify_jwt:true}],manifest),/extra=unexpected/);
 assert.throws(()=>compareLiveRuntime([{slug:'source-worker',version:107,verify_jwt:false},{slug:'diagnostic-probe',version:2,verify_jwt:true}],manifest),/mismatched=source-worker/);
});
