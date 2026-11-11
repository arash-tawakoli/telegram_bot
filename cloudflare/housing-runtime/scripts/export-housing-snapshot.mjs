import { chmod, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

const ALLOWLIST = [1, 3, 23, 29, 34, 35, 66, 69, 71];
const sourceUrl = process.env.LEGACY_DATABASE_URL;
const output = resolve(process.env.HOUSING_SNAPSHOT_FILE || `housing-snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

if (!sourceUrl) throw new Error("LEGACY_DATABASE_URL is required");

async function rows(sql, query) { return sql.unsafe(query); }

export async function exportSnapshot(sql) {
  const ids = ALLOWLIST.join(",");
  const tables = {
    source_registry: await rows(sql, `SELECT s.id,s.name,CASE WHEN s.id IN (1,69) THEN 'immoscout24' WHEN s.id IN (3,71) THEN 'immowelt' ELSE 'immomio' END AS family,CASE WHEN c.connector_kind='immomio_tenant' THEN 'immomio_tenant' WHEN s.id IN (1,69) THEN 'mcp' WHEN s.id IN (3,71) THEN 'html_discovery' ELSE c.connector_kind END AS connector,COALESCE(c.config,'{}'::jsonb) AS connector_config,s.enabled,s.last_success_at,s.consecutive_failures FROM public.sources s JOIN public.source_connectors c ON c.source_id=s.id WHERE s.id IN (${ids}) AND c.connector_role='primary' AND c.enabled=true`),
    participants: await rows(sql, `SELECT u.id,p.email,COALESCE(NULLIF(p.first_name,''),NULLIF(u.first_name,''),'Teilnehmer') AS first_name,COALESCE(NULLIF(p.last_name,''),NULLIF(u.last_name,''),'Unbekannt') AS last_name, u.telegram_user_id,u.chat_id AS telegram_chat_id,COALESCE(u.ui_language,'de') AS ui_language,CASE WHEN u.is_active THEN 'active' ELSE 'archived' END AS status,COALESCE(u.created_at,now()) AS created_at,COALESCE(u.updated_at,now()) AS updated_at FROM public.bot_users u LEFT JOIN public.applicant_profiles p ON p.user_id=u.id`),
    portal_members: await rows(sql, `SELECT cm.id,COALESCE(au.email,'migration+'||cm.id::text||'@invalid.local') AS email,COALESCE(NULLIF(cm.display_name,''),COALESCE(au.email,'Coach')) AS display_name,CASE WHEN cm.is_super_admin THEN 'super_admin' WHEN cm.role='admin' THEN 'admin' ELSE 'coach' END AS role,'migration_required$'||cm.id::text AS password_hash,COALESCE(cm.is_active,false) AS active,COALESCE(cm.created_at,now()) AS created_at,COALESCE(cm.updated_at,now()) AS updated_at FROM public.coaching_members cm LEFT JOIN auth.users au ON au.id=cm.auth_user_id`),
    participant_assignments: await rows(sql, `SELECT cp.user_id AS participant_id,cp.coach_member_id AS member_id,COALESCE(cp.updated_at,now()) AS updated_at FROM public.coaching_participants cp WHERE cp.coach_member_id IS NOT NULL`),
    applicant_profiles: await rows(sql, `SELECT p.user_id AS participant_id,to_jsonb(p)-'user_id' AS profile,COALESCE(p.updated_at,now()) AS updated_at FROM public.applicant_profiles p`),
    search_profiles: await rows(sql, `SELECT s.id,s.user_id AS participant_id,to_jsonb(s)-ARRAY['id','user_id']::text[] AS criteria,COALESCE(s.is_active,false) AS active,COALESCE(s.created_at,now()) AS created_at,COALESCE(s.updated_at,now()) AS updated_at FROM public.search_profiles s`),
    application_preferences: await rows(sql, `SELECT a.user_id AS participant_id,a.enabled,a.daily_limit,COALESCE(a.timezone,'Europe/Berlin') AS timezone,a.allowed_weekdays,a.send_window_start,a.send_window_end,COALESCE(a.immoscout_enabled,false) AS immoscout_enabled,COALESCE(a.immowelt_enabled,false) AS immowelt_enabled,COALESCE(a.immomio_enabled,false) AS immomio_enabled,COALESCE(a.updated_at,now()) AS updated_at FROM public.application_preferences a`),
    provider_connections: await rows(sql, `SELECT gen_random_uuid() AS id,c.user_id AS participant_id,CASE c.provider WHEN 'immoscout' THEN 'immoscout24' ELSE c.provider END AS provider,CASE c.status WHEN 'connected' THEN 'connected' WHEN 'needs_login' THEN 'needs_login' WHEN 'error' THEN 'error' ELSE 'disconnected' END AS status,c.credential_ciphertext AS ciphertext,c.credential_iv AS iv,c.key_version,c.expires_at,COALESCE(c.updated_at,now()) AS updated_at FROM public.platform_connections c WHERE c.provider IN ('immoscout','immowelt','immomio')`),
    documents: await rows(sql, `SELECT d.id,d.user_id AS participant_id,d.storage_path AS object_key,d.original_filename,d.document_type,COALESCE(d.mime_type,'application/octet-stream') AS content_type,COALESCE(d.size_bytes,0) AS size_bytes,COALESCE(d.send_with_auto_apply,false) AS send_with_auto_apply,COALESCE(d.created_at,now()) AS created_at FROM public.applicant_documents d`),
    offer_identities: await rows(sql, `SELECT l.id,l.source_id,CASE WHEN COALESCE(l.external_id,l.source_listing_key) IS NOT NULL AND COALESCE(l.external_id,l.source_listing_key)<>'' THEN l.source_id::text||':external:'||COALESCE(l.external_id,l.source_listing_key) ELSE l.source_id::text||':url:'||l.canonical_url END AS identity_hash,COALESCE(l.external_id,l.source_listing_key) AS external_id,l.canonical_url,jsonb_build_object('title',l.title,'address',l.address,'district',l.district,'postal_code',l.postal_code,'city',l.city,'warm_rent',l.warm_rent,'cold_rent',l.cold_rent,'rooms',l.rooms,'area_sqm',l.area_sqm,'available_from',l.available_from,'property_type',l.property_type,'wbs_required',l.wbs_required,'image_url',l.image_url) AS facts,COALESCE(l.first_seen_at,now()) AS first_seen_at,COALESCE(l.last_seen_at,now()) AS last_seen_at,COALESCE(l.first_seen_at,now())+interval '24 hours' AS expires_at FROM public.listings l WHERE l.source_id IN (${ids})`),
    deliveries: await rows(sql, `SELECT d.id,sp.user_id AS participant_id,d.listing_id AS offer_identity_id,sp.user_id::text||':'||oi_hash.identity_hash AS idempotency_key,CASE d.status WHEN 'sent' THEN 'sent' WHEN 'failed' THEN 'failed' WHEN 'skipped' THEN 'skipped' ELSE 'pending' END AS status,d.telegram_message_id,COALESCE(d.created_at,now()) AS created_at,d.sent_at,d.error_message FROM public.delivery_events d JOIN public.search_profiles sp ON sp.id=d.profile_id JOIN (SELECT id,CASE WHEN COALESCE(external_id,source_listing_key) IS NOT NULL AND COALESCE(external_id,source_listing_key)<>'' THEN source_id::text||':external:'||COALESCE(external_id,source_listing_key) ELSE source_id::text||':url:'||canonical_url END AS identity_hash FROM public.listings WHERE source_id IN (${ids})) oi_hash ON oi_hash.id=d.listing_id WHERE d.listing_id IS NOT NULL`),
  };
  const sourceLinks = [];
  for (const profile of tables.search_profiles) for (const source of tables.source_registry) sourceLinks.push({ search_profile_id: profile.id, source_id: source.id });
  tables.source_links = sourceLinks;
  return { version: 1, exported_at: new Date().toISOString(), allowlist: ALLOWLIST, tables };
}

const sql = postgres(sourceUrl, { max: 2, prepare: true });
try {
  const snapshot = await exportSnapshot(sql);
  await writeFile(output, JSON.stringify(snapshot), { mode: 0o600 });
  await chmod(output, 0o600);
  console.log(JSON.stringify({ output, tables: Object.fromEntries(Object.entries(snapshot.tables).map(([name, values]) => [name, values.length])) }));
} finally { await sql.end({ timeout: 5 }); }
