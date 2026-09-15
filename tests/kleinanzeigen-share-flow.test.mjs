import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sessions=readFileSync(new URL('../supabase/functions/telegram-ui/platform-sessions.js',import.meta.url),'utf8');
const handlers=readFileSync(new URL('../supabase/functions/telegram-ui/handlers.js',import.meta.url),'utf8');

test('Kleinanzeigen callback can be completed from a Telegram share message',()=>{
 assert.match(sessions,/export function kleinCallbackFromMessage\(message\)/);
 assert.match(sessions,/login\\\.kleinanzeigen\\\.de\\\/android\\\/com\\\.ebay\\\.kleinanzeigen\\\/callback/);
 assert.match(sessions,/applicationWorker\('complete_login',user\.id,2,\{callbackUrl\}\)/);
 assert.match(sessions,/deleteMessage/);
 assert.match(handlers,/handleAutoApplyMessage\(user, message\)/);
});

test('user-facing Kleinanzeigen login uses share-to-Telegram without app install',()=>{
 assert.match(sessions,/Teilen/);
 assert.match(sessions,/Telegram → Traumwohnung Hamburg/);
 assert.match(sessions,/nichts kopieren, einfügen oder zusätzlich installieren/);
 assert.doesNotMatch(sessions,/installierte Traumwohnung Safari-Erweiterung/);
});

test('callback parser requires exact Kleinanzeigen callback and auth state',()=>{
 assert.match(sessions,/KLEIN_CALLBACK_ORIGIN='https:\/\/login\.kleinanzeigen\.de'/);
 assert.match(sessions,/KLEIN_CALLBACK_PATH='\/android\/com\.ebay\.kleinanzeigen\/callback'/);
 assert.match(sessions,/searchParams\.get\('state'\)/);
 assert.match(sessions,/searchParams\.get\('code'\).*searchParams\.get\('error'\)/s);
});
