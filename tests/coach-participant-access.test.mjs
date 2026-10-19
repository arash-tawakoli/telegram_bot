import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const coach=readFileSync(new URL('supabase/functions/coach-api/index.ts',root),'utf8');
const migrationName=readdirSync(new URL('supabase/migrations/',root)).find(name=>name.endsWith('_coach_participant_access_and_premium.sql'));
assert.ok(migrationName,'participant access migration is present');
const migration=readFileSync(new URL('supabase/migrations/'+migrationName,root),'utf8');

test('portal Premium is assigned only to newly created coaching identities',()=>{
  assert.match(migration,/new\.origin='coaching' and new\.telegram_user_id is null/);
  assert.match(migration,/new\.plan_override='premium'/);
  assert.match(migration,/before insert on public\.bot_users/);
  assert.doesNotMatch(migration,/update public\.bot_users[\s\S]*plan_override='premium'/);
});

test('participant import enumerates Telegram users and distinguishes unassigned portal identities',()=>{
  assert.match(coach,/\.not\('telegram_user_id','is',null\)/);
  assert.match(coach,/\.range\(offset,offset\+499\)/);
  assert.match(coach,/alreadyInPortal:Boolean\(assignment/);
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
