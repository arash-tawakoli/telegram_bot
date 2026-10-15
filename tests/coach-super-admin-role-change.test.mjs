import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/coach-api/index.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261015125606_coach_super_admin_role_change.sql',import.meta.url),'utf8');

test('only Super Admin can request a regular member role change',()=>{
 assert.match(source,/action==='change_coach_role'/);
 assert.match(source,/a\\.member\\.is_super_admin!==true/);
 assert.match(source,/coach_change_member_role/);
 assert.match(source,/member_role_update_failed/);
 assert.match(migration,/coach_change_member_role/);
 assert.match(migration,/v_actor\\.is_super_admin is not true/);
 assert.match(migration,/p_actor=p_member/);
 assert.match(migration,/revoke all on function public\\.coach_change_member_role/);
});

console.log('Super Admin role-change guards passed.');
