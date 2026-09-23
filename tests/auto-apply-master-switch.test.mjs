import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync(new URL('../supabase/migrations/20260923114300_master_auto_apply_switch.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../supabase/functions/telegram-gateway/auto-apply.ts',import.meta.url),'utf8');

test('master switch is authoritative for supported providers',()=>{
  assert.match(migration,/select p\.enabled/);
  assert.match(migration,/p_provider in \('immoscout','kleinanzeigen','immomio'\)/);
  assert.match(migration,/immoscout_enabled=excluded\.immoscout_enabled/);
  assert.match(migration,/kleinanzeigen_enabled=excluded\.kleinanzeigen_enabled/);
  assert.match(migration,/immomio_enabled=excluded\.immomio_enabled/);
});

test('disabling auto-apply cancels unsent pending work',()=>{
  assert.match(migration,/last_error='auto_apply_disabled'/);
  assert.match(migration,/status='pending'/);
  assert.match(migration,/submission_started_at is null/);
});

test('Telegram no longer exposes an independent provider toggle',()=>{
  assert.match(ui,/zentral über den Hauptschalter gesteuert/);
  assert.match(ui,/alle verbundenen unterstützten Plattformen/);
  assert.doesNotMatch(ui,/Plattform für AutoApply freigegeben/);
});
