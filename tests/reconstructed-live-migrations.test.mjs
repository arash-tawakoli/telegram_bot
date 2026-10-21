import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const migrationFiles=[
 ['20261002162748','repair_application_queue_reconciliation'],
 ['20261002170417','platform_session_reauth_notifications'],
 ['20261002181908','user_engagement_campaigns'],
 ['20261002213748','add_wg_gesucht_platform_login'],
 ['20261007115124','revoke_public_execute_on_internal_rpcs'],
 ['20261007115302','add_missing_fk_indexes'],
 ['20261019222908','allow_admin_participant_assignment'],
 ['20261019224939','add_jobseeker_workspace'],
];
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('reconstructed live migration history is fully registered with matching content hashes',async()=>{
 const fragment=JSON.parse(await read('docs/migration-registry.d/20261021-reconstructed-live-migrations.json'));
 assert.equal(fragment.migrations.length,8);
 for(const [version,name] of migrationFiles){
  const entry=fragment.migrations.find(x=>x.version===version);
  assert.ok(entry,'missing registry entry '+version);
  assert.equal(entry.name,name);
  assert.equal(entry.file,'supabase/migrations/'+version+'_'+name+'.sql');
  const sql=await read(entry.file);
  assert.equal(createHash('sha256').update(sql).digest('hex'),entry.export_sql_sha256);
  assert.match(sql,/RECONSTRUCTED EQUIVALENT/);
 }
});

test('reconstructed service-only tables remain closed to client roles',async()=>{
 const reauth=await read('supabase/migrations/20261002170417_platform_session_reauth_notifications.sql');
 const engagement=await read('supabase/migrations/20261002181908_user_engagement_campaigns.sql');
 const job=await read('supabase/migrations/20261019224939_add_jobseeker_workspace.sql');
 for(const sql of [reauth,engagement,job]){
  assert.match(sql,/enable row level security/i);
  assert.match(sql,/revoke all on table[\s\S]*from public,\s*anon,\s*authenticated/i);
  assert.match(sql,/grant all on table[\s\S]*to service_role/i);
 }
});

test('reconstructed provider and assignment contracts retain explicit allowed values and role checks',async()=>{
 const wg=await read('supabase/migrations/20261002213748_add_wg_gesucht_platform_login.sql');
 const assignment=await read('supabase/migrations/20261019222908_allow_admin_participant_assignment.sql');
 assert.match(wg,/wg_gesucht/);
 assert.match(assignment,/role<>'admin'|role <> 'admin'/i);
 assert.match(assignment,/workspace_unavailable/);
 assert.match(assignment,/participant_already_assigned/);
});
