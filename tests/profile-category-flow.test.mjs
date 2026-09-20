import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const profiles=readFileSync(new URL('../supabase/functions/telegram-ui/profiles.js',import.meta.url),'utf8');
const handlers=readFileSync(new URL('../supabase/functions/telegram-ui/handlers.js',import.meta.url),'utf8');
const runtime=readFileSync(new URL('../supabase/functions/telegram-ui/runtime.js',import.meta.url),'utf8');

test('WG profiles use their own room-area criterion',()=>{
  assert.match(profiles,/ROOM_AREA_PRESETS/);
  assert.match(profiles,/property_types\.includes\("WG"\)/);
  assert.match(profiles,/renderRoomArea/);
  assert.match(profiles,/min_room_area_sqm/);
  assert.match(handlers,/roomarea:/);
});

test('profile persistence uses the leased atomic RPC when available',()=>{
  assert.match(profiles,/save_search_profile_ui/);
  assert.match(runtime,/save_ui_state/);
  assert.match(runtime,/finish_ui_update/);
});

test('Telegram edit fallback is limited to actually uneditable messages',()=>{
  assert.match(runtime,/message is not modified/i);
  assert.match(runtime,/message to edit not found\|message can't be edited/);
  assert.match(runtime,/throw error/);
});
