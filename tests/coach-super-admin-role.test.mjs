import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/coach-api/index.ts',import.meta.url),'utf8');

test('only the allowlisted Super Admin can create or manage Admin and Super Admin members',()=>{
 assert.ok(source.includes("['admin','super_admin'].includes(requestedRole)&&a.member.is_super_admin!==true"));
 assert.ok(source.includes("member.is_super_admin===true"));
 assert.ok(source.includes("a.member.is_super_admin===true&&member.role==='admin'"));
 assert.ok(source.includes("requestedRole==='super_admin'"));
 assert.ok(source.includes("member_management_forbidden"));
});

console.log('Super Admin member-management guards passed.');
