import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/coach-api/index.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261015153949_coach_super_admin_role_management.sql',import.meta.url),'utf8');

test('only Super Admin can request a regular member role change',()=>{
 assert.ok(source.includes("action==='change_coach_role"));
 assert.ok(source.includes("a.member.is_super_admin!==true"));
 assert.ok(source.includes("admin.rpc('coach_change_member_role'"));
 assert.ok(source.includes("member_role_update_failed"));
 assert.ok(source.includes("requestedRole==='super_admin'"));
 assert.ok(source.includes("super_admin_required"));
 assert.ok(migration.includes('coach_change_member_role'));
 assert.ok(migration.includes('v_actor.is_super_admin is not true'));
 assert.ok(migration.includes('p_actor=p_member'));
 assert.ok(migration.includes("when 'super_admin'"));
 assert.ok(migration.includes('v_is_super_admin'));
 assert.ok(migration.includes('super_admin_required'));
 assert.ok(migration.includes('revoke all on function public.coach_change_member_role'));
});

console.log('Super Admin role-change guards passed.');

