import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sessions=readFileSync(new URL('../supabase/functions/telegram-ui/platform-sessions.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8');
const telegram=readFileSync(new URL('../supabase/functions/telegram-oauth-bridge/index.ts',import.meta.url),'utf8');
const coach=readFileSync(new URL('../supabase/functions/coach-api/index.ts',import.meta.url),'utf8');

test('Kleinanzeigen share callback is recognized and completed server-side',()=>{
 assert.match(sessions,/kleinCallbackFromMessage/);
 assert.match(sessions,/KLEIN_CALLBACK_ORIGIN='https:\/\/login\.kleinanzeigen\.de'/);
 assert.match(sessions,/KLEIN_CALLBACK_PATH='\/android\/com\.ebay\.kleinanzeigen\/callback'/);
 assert.match(sessions,/complete_shared_login/);
 assert.match(worker,/action==='complete_shared_login'/);
 assert.match(worker,/completeKleinanzeigenCallback/);
});

test('Telegram and coach start the temporary share flow',()=>{
 assert.match(worker,/action==='login_share'/);
 assert.match(worker,/transport:'telegram-share'/);
 assert.match(telegram,/action:'login_share'/);
 assert.match(telegram,/TraumWohnung Hamburg/);
 assert.match(coach,/direct\?'login':'login_share'/);
 assert.doesNotMatch(telegram,/remote\/kleinanzeigen\/open/);
 assert.doesNotMatch(coach,/remote\/kleinanzeigen\/open/);
});
