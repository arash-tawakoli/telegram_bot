import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Telegram applicant profile uses one current UI for existing and future users', async () => {
  const [fast, core, migration] = await Promise.all([
    read('supabase/functions/telegram-gateway/fast-ui.ts'),
    read('supabase/functions/telegram-ui/platform-sessions.js'),
    read('supabase/migrations/20260930115818_unify_current_applicant_profile_ui_v2.sql'),
  ]);

  assert.match(fast, /fieldButton\("email","E-Mail"\)/);
  assert.match(core, /email:\{label:'E-Mail-Adresse',required:true/);
  assert.match(core, /f\('email','E-Mail \*'\)/);
  assert.doesNotMatch(fast, /<b>Pflichtfelder pro Portal<\/b>/);

  assert.match(fast, /if\(view==="applicant_setup_prompt"\)return result\("editMessageText"/);
  assert.doesNotMatch(fast, /applicant_setup_prompt"\)return\{method:"sendMessage"/);
  assert.doesNotMatch(fast, /;\\n if\(view=/);

  assert.match(migration, /check \(length\(trim\(first_name\)\) <= 120\)/);
  assert.match(migration, /check \(length\(trim\(last_name\)\) <= 120\)/);
  assert.match(migration, /return array\['Vorname','Nachname','E-Mail-Adresse'\]/);
  assert.match(migration, /and p\.email is not null/);
  assert.match(migration, /insert into public\.applicant_profiles\(user_id,first_name,last_name\)/);
  assert.doesNotMatch(migration, /'view','applicant_setup_prompt'/);
  assert.doesNotMatch(migration, /p\.schufa_status='AVAILABLE'/);
});
