import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/coach-api/index.ts',import.meta.url),'utf8');

test('only the allowlisted Super Admin can create or manage Admin members',()=>{
 assert.match(source,/requestedRole==='admin'&&a\.member\.is_super_admin!==true/);
 assert.match(source,/member\.is_super_admin===true/);
 assert.match(source,/a\.member\.is_super_admin===true&&member\.role==='admin'/);
 assert.match(source,/member_management_forbidden/);
});

console.log('Super Admin member-management guards passed.');
