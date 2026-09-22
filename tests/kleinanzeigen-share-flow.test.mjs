import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sessions=readFileSync(new URL('../supabase/functions/telegram-ui/platform-sessions.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8');

test('Kleinanzeigen no longer uses Telegram share callback completion',()=>{
 assert.doesNotMatch(sessions,/kleinCallbackFromMessage/);
 assert.doesNotMatch(sessions,/Telegram → Traumwohnung Hamburg/);
 assert.doesNotMatch(sessions,/android\/com\.ebay\.kleinanzeigen\/callback[^\n]*complete_login/);
 assert.doesNotMatch(worker,/transport:'safari-extension-bridge'/);
});

test('Kleinanzeigen requires direct provider OAuth callback',()=>{
 assert.match(worker,/oauth_client_not_provisioned/);
 assert.match(worker,/direct-oauth-callback/);
 assert.match(worker,/oauth=kleinanzeigen/);
});
