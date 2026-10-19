import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const coach=readFileSync(new URL('supabase/functions/coach-api/index.ts',root),'utf8');
const telegramAdmin=readFileSync(new URL('supabase/functions/telegram-ui/admin.js',root),'utf8');
const migrationsDirectory=new URL('supabase/migrations/',root);
const migrationName=readdirSync(migrationsDirectory).find(name=>name.endsWith('_coach_participant_access_and_premium.sql'));
const actionMigrationName=readdirSync(migrationsDirectory).find(name=>name.endsWith('_coach_participant_actions.sql'));
assert.ok(migrationName,'participant access migration is present');
assert.ok(actionMigrationName,'participant action migration is present');
const migration=readFileSync(new URL('supabase/migrations/'+migrationName,root),'utf8');
const actionMigration=readFileSync(new URL('supabase/migrations/'+actionMigrationName,root),'utf8');

test('portal Premium is assigned only to newly created coaching identities',()=>{
  assert.match(migration,/new\.origin='coaching' and new\.telegram_user_id is null/);
  assert.match(migration,/new\.plan_override='premium'/);
  assert.match(migration,/before insert on public\.bot_users/);
  assert.doesNotMatch(migration,/update public\.bot_users[\s\S]*plan_override='premium'/);
});

test('participant import enumerates Telegram users and distinguishes unassigned portal identities',()=>{
  assert.match(coach,/\.not\('telegram_user_id','is',null\)/);
  assert.match(coach,/\.range\(offset,offset\+499\)/);
  assert.match(coach,/const available=bots\.filter\(\(x:any\)=>!assignmentMap\.has\(String\(x\.id\)\)\)/);
  assert.doesNotMatch(coach,/assigned\.workspace_id===a\.member\.workspace_id&&!assigned\.coach_member_id/);
  assert.match(coach,/action==='adopt_participants'/);
  assert.match(migration,/coach_assign_unassigned_participant/);
});

test('admin and super-admin targets are accepted only for authorized assignments',()=>{
  assert.match(migration,/role in \('coach','admin'\)/);
  assert.match(migration,/if not found or v_actor\.role<>'admin' then raise exception 'admin_required'/);
  assert.match(migration,/coach_reassign_participant/);
  assert.match(migration,/revoke all on function public\.coach_reassign_participant\(uuid,uuid,uuid\)[\s\S]*?grant execute[\s\S]*?to service_role/);
});

test('participant deletion checks assignment ownership and preserves Telegram identities',()=>{
  assert.match(coach,/action==='delete_participant'/);
  assert.match(migration,/coach_delete_participant/);
  assert.match(migration,/v_actor\.role<>'admin' and v_assignment\.coach_member_id is distinct from v_actor\.id/);
  assert.match(migration,/participant_removed_from_portal/);
  assert.match(migration,/delete from public\.bot_users where id=p_user/);
  assert.match(migration,/revoke all on function public\.coach_delete_participant\(uuid,uuid\)[\s\S]*?grant execute[\s\S]*?to service_role/);
});

test('deleting a Telegram user also removes the portal row through the database cascade',()=>{
  assert.match(telegramAdmin,/await db\.from\("bot_users"\)\.delete\(\)\.eq\("id", userId\)/);
  assert.match(actionMigration,/delete from public\.bot_users where id=p_user/);
  assert.match(actionMigration,/bot_users deletion cascades to coaching_participants/i);
  assert.match(actionMigration,/delete from public\.platform_sessions where user_id=p_user/);
});

test('web actions support permanent deletion, blocking and tariff changes with backend checks',()=>{
  assert.match(coach,/body\.permanent===true/);
  assert.match(coach,/coach_delete_participant_permanently/);
  assert.match(actionMigration,/create or replace function public\.coach_delete_participant_permanently/);
  assert.match(actionMigration,/if v_actor\.role<>'admin' and v_assignment\.coach_member_id is distinct from v_actor\.id/);
  assert.match(coach,/action==='block_participant'/);
  assert.match(coach,/if\(a\.member\.role!=='admin'\)throw Error\('admin_required'\)/);
  assert.match(coach,/update\(\{is_active:!blocked,updated_at:new Date\(\)\.toISOString\(\)\}\)/);
  assert.match(coach,/action==='set_plan'/);
});
