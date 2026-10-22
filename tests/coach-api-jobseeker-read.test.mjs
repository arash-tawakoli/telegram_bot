import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/coach-api/index.ts',import.meta.url),'utf8');
const dispatcher=source.match(/const assignment=\[([^\]]+)\]\.includes\(action\)\?null:await assignmentFor/);
assert.ok(dispatcher,'Coach API assignment dispatcher should exist');
assert.match(dispatcher[1],/'source_health'/,'source-health reads must not require a participant id');
assert.match(dispatcher[1],/'jobseekers'/,'jobseeker list reads must not require a participant id');
assert.match(source,/if\(\['jobseekers','jobseeker'\]\.includes\(action\)&&actual\.member\.is_super_admin!==true\)throw Error\('super_admin_required'\)/);
assert.match(source,/if\(action==='jobseekers'\)return\{participants:await participantSummary\(actual,'all'\)\}/);
assert.match(source,/if\(action==='jobseeker'\)\{[\s\S]*?jobseeker_profiles[\s\S]*?job_search_profiles[\s\S]*?job_application_preferences[\s\S]*?job_applications/);
assert.match(source,/if\(action==='source_health'\)/);
console.log('Coach API source-health and jobseeker read dispatch assertions passed.');
