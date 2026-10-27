import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/coach-api/index.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261027215300_coach_resume_drafts.sql',import.meta.url),'utf8');

const preview=source.match(/const allowed=new Set\(\[([^\]]+)\]\);/);
assert.ok(preview,'Preview action allowlist should exist');
assert.match(preview[1],/'resume_list'/,'Manager preview may read its own resume drafts');
assert.doesNotMatch(preview[1],/'resume_save'|'resume_delete'/,'Manager preview must not mutate resume drafts');

assert.match(source,/async function listResumeDrafts\(a:any\)/);
assert.match(source,/async function saveResumeDraft\(a:any,body:any\)/);
assert.match(source,/async function deleteResumeDraft\(a:any,body:any\)/);
assert.match(source,/if\(action==='resume_list'\)return listResumeDrafts\(a\)/);
assert.match(source,/if\(action==='resume_save'\)return saveResumeDraft\(a,body\)/);
assert.match(source,/if\(action==='resume_delete'\)return deleteResumeDraft\(a,body\)/);
assert.match(source,/\.eq\('workspace_id',a\.member\.workspace_id\)\.eq\('owner_member_id',a\.member\.id\)/);
assert.match(source,/if\(JSON\.stringify\(data\)\.length>85000\)throw Error\('resume_too_large'\)/);
assert.match(source,/resume_data_invalid/);

assert.match(migration,/create table if not exists public\.coach_resume_drafts/);
assert.match(migration,/alter table public\.coach_resume_drafts enable row level security/);
assert.match(migration,/revoke all on table public\.coach_resume_drafts from public, anon, authenticated/);
assert.match(migration,/grant all on table public\.coach_resume_drafts to service_role/);
assert.match(migration,/create policy coach_resume_drafts_service_role_only/);
console.log('Coach resume API authorization and storage contract checks passed.');
