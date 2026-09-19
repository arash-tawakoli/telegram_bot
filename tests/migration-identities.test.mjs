import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMigrationEntries} from '../scripts/check-runtime.mjs';
const row={version:'20260919171615',name:'preserve_cooperative_object_identity_dedupe',file:'supabase/migrations/20260919171615_preserve_cooperative_object_identity_dedupe.sql'};
test('migration registry enforces exact applied version and filename identity',()=>{
 assert.deepEqual(validateMigrationEntries([row]),[row]);
 assert.throws(()=>validateMigrationEntries([{...row,file:row.file.replace('20260919171615','20260919180000')}]),/filename\/version mismatch/);
});
test('migration registry rejects duplicate versions and invalid identifiers',()=>{
 assert.throws(()=>validateMigrationEntries([row,row]),/Duplicate migration version/);
 assert.throws(()=>validateMigrationEntries([{...row,version:'invented'}]),/Invalid migration version/);
});
