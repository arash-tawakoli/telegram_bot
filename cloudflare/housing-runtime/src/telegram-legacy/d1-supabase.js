import { missingApplicantFields, premiumParticipant } from "../application-policy.js";
import { HOME_LANGUAGES } from "./home-language.js";

import { sha256 } from "../auth.js";
const TABLES = {
  bot_users: "participants",
  search_profiles: "search_profiles",
  applicant_profiles: "applicant_profiles",
  platform_connections: "provider_connections",
  applicant_documents: "documents",
  listings: "offer_identities",
  delivery_events: "deliveries",
  applications: "applications",
  sources: "source_registry",
  application_preferences: "application_preferences",
  user_subscriptions: "user_subscriptions",
  referral_codes: "referral_codes",
  referrals: "referrals",
  platform_reauth_notifications: "platform_reauth_notifications",
  user_engagement_notifications: "user_engagement_notifications",
  platform_auth_flows: "provider_auth_flows",
  telegram_announcements: "telegram_announcements",
};
const ALIASES = {
  bot_users: { user_id: "id", chat_id: "telegram_chat_id", is_active: "status", onboarding_state: "telegram_state" },
  search_profiles: { user_id: "participant_id", is_active: "active" },
  applicant_profiles: { user_id: "participant_id" },
  platform_connections: { user_id: "participant_id", credential_ciphertext: "ciphertext", credential_iv: "iv" },
  platform_auth_flows: { user_id: "participant_id" },
  applicant_documents: { user_id: "participant_id", storage_path: "object_key", mime_type: "content_type" },
  listings: { source_listing_key: "external_id", is_active: "expires_at", title: "facts", raw: "facts" },
  delivery_events: { profile_id: "participant_id", listing_id: "offer_identity_id" },
  applications: { user_id: "participant_id", listing_id: "offer_identity_id" },
  application_preferences: { user_id: "participant_id" },
  user_subscriptions: { user_id: "participant_id" },
  referral_codes: { user_id: "participant_id" },
  referrals: { referrer_user_id: "referrer_participant_id", referred_user_id: "referred_participant_id" },
  platform_reauth_notifications: { user_id: "participant_id" },
  user_engagement_notifications: { user_id: "participant_id" },
};

const ALLOWLIST = [1, 2, 3, 23, 29, 35, 66, 69, 71, 72];

function json(value, fallback = {}) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function bool(value) { return value === true || value === 1 || value === "1"; }
function scalar(value) {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return JSON.stringify(value);
}

function mapColumn(table, column) {
  return ALIASES[table]?.[column] || column;
}

function telegramControlOrder(args, callbackData, supersedingCallbacks) {
  if (args.p_update_id == null) return { sql: "", params: [], record: null };
  const updateId = Number(args.p_update_id);
  const telegramUserId = Number(args.p_telegram_user_id);
  if (!Number.isSafeInteger(updateId) || updateId < 0 || !Number.isSafeInteger(telegramUserId) || telegramUserId < 1) {
    return { error: new Error("telegram_control_update_invalid") };
  }
  return {
    sql: ` AND EXISTS (SELECT 1 FROM telegram_updates WHERE update_id=? AND telegram_user_id=? AND callback_data=?) AND NOT EXISTS (SELECT 1 FROM telegram_updates WHERE telegram_user_id=? AND update_id>? AND callback_data IN (${supersedingCallbacks.map(() => "?").join(",")}))`,
    params: [updateId, telegramUserId, callbackData, telegramUserId, updateId, ...supersedingCallbacks],
    record: {
      query: "UPDATE telegram_updates SET telegram_user_id=?,callback_data=? WHERE update_id=? AND kind='callback_query'",
      params: [telegramUserId, callbackData, updateId],
    },
  };
}

function outputRow(table, row) {
  if (!row) return row;
  const facts = json(row.facts, {});
  const profile = json(row.profile, {});
  if (table === "bot_users") return {
    ...row,
    chat_id: row.telegram_chat_id,
    is_active: row.status === "active",
    onboarding_state: json(row.telegram_state, {}),
    onboarding_step: json(row.telegram_state, {})._step || null,
    telegram_user_id: row.telegram_user_id,
    user_id: row.id,
    plan_override: row.plan_override ?? null,
    plan_override_expires_at: row.plan_override_expires_at ?? null,
    referral_bonus_until: row.referral_bonus_until ?? null,
    auto_apply_enabled: bool(row.auto_apply_enabled),
    test_auto_apply_allowed: bool(row.test_auto_apply_allowed),
    test_auto_apply_enabled: bool(row.test_auto_apply_enabled),
    test_auto_apply_daily_limit: Number(row.test_auto_apply_daily_limit || 0),
    test_auto_apply_enabled_at: row.test_auto_apply_enabled_at ?? null,
    test_auto_apply_disabled_at: row.test_auto_apply_disabled_at ?? null,
  };
  if (table === "search_profiles") {
    const criteria = json(row.criteria, {});
    return { ...criteria, ...row, user_id: row.participant_id, is_active: bool(row.active), profile_slot: Number(row.profile_slot ?? criteria.profile_slot ?? 1), name: criteria.name || null, property_types: criteria.property_types || [] };
  }
  if (table === "applicant_profiles") return { ...profile, ...row, user_id: row.participant_id };
  if (table === "platform_connections") return { ...row, user_id: row.participant_id, credential_ciphertext: row.ciphertext, credential_iv: row.iv };
  if (table === "applicant_documents") return { ...row, user_id: row.participant_id, storage_path: row.object_key, mime_type: row.content_type };
  if (table === "listings") return { ...facts, ...row, title: facts.title || "Wohnungsangebot", is_active: !row.expires_at || new Date(row.expires_at).getTime() > Date.now(), source_listing_key: row.external_id, raw: facts };
  if (table === "delivery_events") return { ...row, listing_id: row.offer_identity_id, profile_id: row.participant_id };
  if (table === "applications") return { ...row, user_id: row.participant_id, listing_id: row.offer_identity_id, test_mode: bool(row.test_mode) };
  if (table === "platform_auth_flows") return { ...row, user_id: row.participant_id, context: json(row.context, {}) };
  if (table === "application_preferences") return { ...row, user_id: row.participant_id, enabled: bool(row.enabled), immoscout_enabled: bool(row.immoscout_enabled), immomio_enabled: bool(row.immomio_enabled), immowelt_enabled: bool(row.immowelt_enabled) };
  if (table === "user_subscriptions") return { ...row, user_id: row.participant_id, cancel_at_period_end: bool(row.cancel_at_period_end) };
  if (table === "referral_codes") return { ...row, user_id: row.participant_id, active: bool(row.active) };
  if (table === "referrals") return { ...row, referrer_user_id: row.referrer_participant_id, referred_user_id: row.referred_participant_id };
  if (table === "platform_reauth_notifications") return { ...row, user_id: row.participant_id };
  if (table === "user_engagement_notifications") return { ...row, user_id: row.participant_id };
  if (table === "sources") return { ...row, enabled: bool(row.enabled) };
  return row;
}

class Query {
  constructor(client, table) { this.client = client; this.table = table; this.physical = TABLES[table]; this.operation = "select"; this.selectSpec = "*"; this.filters = []; this.orders = []; this.limitValue = null; this.offsetValue = null; this.countMode = false; this.head = false; this.payload = null; this.returning = false; }
  select(spec = "*", options = {}) { if (this.operation === "insert" || this.operation === "upsert") this.returning = true; this.selectSpec = spec; this.countMode = options.count === "exact"; this.head = options.head === true; return this; }
  eq(column, value) { if (this.table === "bot_users" && column === "is_active") this.filters.push(["status", bool(value) ? "=" : "<>", "active"]); else this.filters.push([mapColumn(this.table, column), "=", value]); return this; }
  neq(column, value) { this.filters.push([mapColumn(this.table, column), "<>", value]); return this; }
  gt(column, value) { this.filters.push([mapColumn(this.table, column), ">", value]); return this; }
  gte(column, value) { this.filters.push([mapColumn(this.table, column), ">=", value]); return this; }
  lt(column, value) { this.filters.push([mapColumn(this.table, column), "<", value]); return this; }
  lte(column, value) { this.filters.push([mapColumn(this.table, column), "<=", value]); return this; }
  is(column, value) { this.filters.push([mapColumn(this.table, column), value === null ? "IS" : "=", value]); return this; }
  not(column, operator, value) {
    const op = String(operator || "").toLowerCase();
    if (op === "is" && value === null) this.filters.push([mapColumn(this.table, column), "IS NOT", null]);
    else if (op === "eq") this.filters.push([mapColumn(this.table, column), "<>", value]);
    else if (op === "gt") this.filters.push([mapColumn(this.table, column), "<=", value]);
    else if (op === "gte") this.filters.push([mapColumn(this.table, column), "<", value]);
    else if (op === "lt") this.filters.push([mapColumn(this.table, column), ">=", value]);
    else if (op === "lte") this.filters.push([mapColumn(this.table, column), ">", value]);
    else throw new Error("query_operator_not_supported");
    return this;
  }
  in(column, values) { this.filters.push([mapColumn(this.table, column), "IN", values]); return this; }
  or() { return this; }
  order(column, options = {}) { this.orders.push(`${mapColumn(this.table, column)} ${options.ascending === false ? "DESC" : "ASC"}`); return this; }
  limit(value) { this.limitValue = Number(value); return this; }
  range(from, to) { this.offsetValue = Number(from); this.limitValue = Number(to) - Number(from) + 1; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this.exec(); }
  single() { this.singleMode = "single"; return this.exec(); }
  update(payload) { this.operation = "update"; this.payload = payload; return this; }
  insert(payload) { this.operation = "insert"; this.payload = Array.isArray(payload) ? payload : [payload]; return this; }
  upsert(payload, options = {}) { this.operation = "upsert"; this.payload = Array.isArray(payload) ? payload : [payload]; this.conflict = options.onConflict || "id"; this.ignoreDuplicates = options.ignoreDuplicates === true; return this; }
  delete() { this.operation = "delete"; return this; }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
  async exec() {
    if (!this.physical) return { data: this.singleMode === "single" ? null : [], error: null, count: 0 };
    try {
      if (this.operation === "select") return await this.selectRows();
      if (this.operation === "update") return await this.mutate("UPDATE");
      if (this.operation === "delete") return await this.mutate("DELETE");
      return await this.mutate("INSERT");
    } catch (error) { return { data: null, error, count: null }; }
  }
  async selectRows() {
    const params = [];
    const columns = this.selectSpec === "*" ? "*" : this.selectSpec.split(",").map(c => c.trim().split("(")[0]).filter(Boolean).map(c => mapColumn(this.table, c)).join(",");
    let query = `SELECT ${columns || "*"} FROM ${this.physical}`;
    const where = this.where(params); if (where) query += ` WHERE ${where}`;
    if (this.orders.length) query += ` ORDER BY ${this.orders.join(",")}`;
    if (this.limitValue != null) { query += ` LIMIT ?`; params.push(this.limitValue); if (this.offsetValue != null) { query += ` OFFSET ?`; params.push(this.offsetValue); } }
    const rows = await this.client.run(query, params);
    const data = rows.map(row => outputRow(this.table, row));
    if (this.countMode) return { data: this.head ? null : data, error: null, count: data.length };
    if (this.singleMode === "single") { if (data.length !== 1) return { data: null, error: new Error("row_not_found"), count: data.length }; return { data: data[0], error: null, count: 1 }; }
    if (this.singleMode === "maybe") return { data: data[0] || null, error: null, count: data.length };
    return { data, error: null, count: data.length };
  }
  where(params) {
    return this.filters.map(([column, operator, value]) => { if (operator === "IS" || operator === "IS NOT") return `${column} ${operator} NULL`; if (operator === "IN") { const list = (Array.isArray(value) ? value : []).map(() => "?").join(","); params.push(...value.map(scalar)); return `${column} IN (${list || "NULL"})`; } params.push(scalar(value)); return `${column} ${operator} ?`; }).join(" AND ");
  }
  async mutate(kind) {
    if (kind === "DELETE") { const params=[]; const where=this.where(params); const result=await this.client.run(`DELETE FROM ${this.physical}${where?` WHERE ${where}`:""}`,params); return {data:[],error:null,count:result.count}; }
    if (kind === "UPDATE" && this.table === "applicant_profiles") {
      const whereParams = [];
      const where = this.where(whereParams);
      if (!where) return { data: null, error: new Error("applicant_profile_update_requires_filter"), count: 0 };
      const rows = await this.client.run(`SELECT participant_id,profile FROM applicant_profiles WHERE ${where}`, whereParams);
      const patch = { ...(this.payload || {}) };
      delete patch.user_id;
      delete patch.participant_id;
      const updatedAt = patch.updated_at || new Date().toISOString();
      delete patch.updated_at;
      for (const row of rows) {
        const next = { ...json(row.profile, {}), ...patch };
        await this.client.run("UPDATE applicant_profiles SET profile=?,updated_at=? WHERE participant_id=?", [JSON.stringify(next), updatedAt, row.participant_id]);
      }
      return { data: [], error: null, count: rows.length };
    }
    if (kind === "UPDATE") { const entries=Object.entries(this.payload||{}).map(([key,value]) => this.table === "bot_users" && key === "is_active" ? ["status", bool(value) ? "active" : "archived"] : [mapColumn(this.table,key),value]); const params=entries.map(([,value])=>scalar(value)); const whereParams=[]; const where=this.where(whereParams); const sql=`UPDATE ${this.physical} SET ${entries.map(([key])=>`${key}=?`).join(",")}${where?` WHERE ${where}`:""}`; const result=await this.client.run(sql,[...params,...whereParams]); return {data:[],error:null,count:result.count}; }
    const rows=this.payload||[]; let data=[]; for(const row of rows){const mapped={...row}; if(this.table==='bot_users'){mapped.telegram_chat_id=mapped.chat_id; delete mapped.chat_id; mapped.status=mapped.is_active===undefined?(mapped.status||"active"):bool(mapped.is_active)?"active":"archived"; delete mapped.is_active; mapped.telegram_state=JSON.stringify(mapped.onboarding_state||{}); delete mapped.onboarding_state; delete mapped.onboarding_step;} if (this.table === "search_profiles") {
      const criteria = { ...mapped };
      const slot = Number(mapped.profile_slot ?? 1);
      if (!Number.isInteger(slot) || slot < 1 || slot > 4) throw new Error("profile_slot_invalid");
      mapped.id = mapped.id || crypto.randomUUID();
      for (const key of ["id", "user_id", "participant_id", "active", "is_active", "profile_slot", "created_at", "updated_at", "criteria"]) delete criteria[key];
      mapped.criteria = JSON.stringify(criteria);
      mapped.participant_id = mapped.user_id || mapped.participant_id;
      mapped.profile_slot = slot;
      mapped.active = mapped.is_active === false || mapped.active === false || mapped.active === 0 ? 0 : 1;
      delete mapped.user_id;
      delete mapped.is_active;
    } if(this.table==='applicant_profiles'){
      const participantId=mapped.user_id||mapped.participant_id;
      const profile={...mapped};
      delete profile.participant_id;
      delete profile.user_id;
      delete profile.updated_at;
      const updatedAt=mapped.updated_at||new Date().toISOString();
      for(const key of Object.keys(mapped)) delete mapped[key];
      mapped.participant_id=participantId;
      mapped.profile=JSON.stringify(profile);
      mapped.updated_at=updatedAt;
    } for(const [logical,physical] of Object.entries(ALIASES[this.table]||{})){if(Object.prototype.hasOwnProperty.call(mapped,logical)){mapped[physical]=mapped[logical];delete mapped[logical];}} const keys=Object.keys(mapped); const vals=keys.map(k=>scalar(mapped[k])); const placeholders=keys.map(()=>"?").join(","); const sql = this.table === "search_profiles" ? `INSERT INTO ${this.physical} (${keys.join(",")}) VALUES (${placeholders}) ON CONFLICT(participant_id,profile_slot) DO UPDATE SET ${keys.filter(k => !["id","participant_id","profile_slot","created_at","updated_at"].includes(k)).map(k => `${k}=excluded.${k}`).concat("updated_at=CURRENT_TIMESTAMP").join(",")}` : this.table === "applicant_profiles" ? (this.ignoreDuplicates ? `INSERT OR IGNORE INTO applicant_profiles (${keys.join(",")}) VALUES (${placeholders})` : `INSERT INTO applicant_profiles (${keys.join(",")}) VALUES (${placeholders}) ON CONFLICT(participant_id) DO UPDATE SET profile=excluded.profile,updated_at=excluded.updated_at`) : `INSERT OR REPLACE INTO ${this.physical} (${keys.join(",")}) VALUES (${placeholders})`; const result=await this.client.run(sql,vals); if(this.returning) data.push(outputRow(this.table,mapped)); } return {data,error:null,count:rows.length};
  }
}

export function createD1Supabase(db, env) {
  const client = {
    run: async (query, params = []) => {
      const result = params.length ? await db.prepare(query).bind(...params).all() : await db.prepare(query).all();
      const rows = result.results || [];
      rows.count = Number(result.meta?.changes || 0);
      return rows;
    },
    batch: async (statements = []) => {
      const prepared = statements.map(({ query, params = [] }) => {
        const statement = db.prepare(query);
        return params.length ? statement.bind(...params) : statement;
      });
      if (typeof db.batch === "function") return db.batch(prepared);
      const results = [];
      for (const statement of prepared) results.push(await statement.all());
      return results;
    },
  };
  const storage = { from: bucket => ({
    async upload(path, body, options = {}) {
      try {
        if (bucket !== "applicant-documents" || !env.DOCUMENTS) throw new Error("document_storage_unavailable");
        const key = storageKey(path);
        if (options.upsert !== true && await env.DOCUMENTS.head(key)) throw new Error("object_already_exists");
        const httpMetadata = {};
        if (options.contentType) httpMetadata.contentType = String(options.contentType);
        if (options.cacheControl) {
          const value = String(options.cacheControl);
          httpMetadata.cacheControl = /^\d+$/.test(value) ? `max-age=${value}` : value;
        }
        await env.DOCUMENTS.put(key, body, { httpMetadata });
        return { data: { path: key }, error: null };
      } catch (error) { return { data: null, error }; }
    },
    async remove(paths) {
      try {
        if (bucket !== "applicant-documents" || !env.DOCUMENTS) throw new Error("document_storage_unavailable");
        const keys = [...new Set((Array.isArray(paths) ? paths : [paths]).map(storageKey))];
        if (keys.length) await env.DOCUMENTS.delete(keys);
        return { data: keys.map(name => ({ name })), error: null };
      } catch (error) { return { data: null, error }; }
    },
  }) };
  return { from: table => new Query(client, table), rpc: async (name,args={}) => rpc(client, env, name, args), storage };
}

async function hasPremium(client, participantId) {
  const row = (await client.run(
    "SELECT p.plan_override,p.plan_override_expires_at,p.referral_bonus_until,s.status AS subscription_status,s.current_period_end AS subscription_period_end FROM participants p LEFT JOIN user_subscriptions s ON s.participant_id=p.id AND s.provider='stripe' WHERE p.id=? AND p.status='active' LIMIT 1",
    [participantId],
  ))[0];
  return Boolean(row && premiumParticipant(row));
}

function storageKey(path) {
  const key = String(path || "");
  if (!key || key.length > 1024 || key.startsWith("/") || key.includes("\\") || key.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("invalid_storage_path");
  }
  return key;
}
async function rpc(client, env, name, args) {
  if (name === "claim_first_profile_celebration") {
    const participantId = String(args.p_user || "");
    const kind = String(args.p_kind || "");
    if (!participantId || !["search", "applicant"].includes(kind)) {
      return { data: null, error: new Error("profile_celebration_invalid") };
    }
    const guard = kind === "search"
      ? "EXISTS(SELECT 1 FROM search_profiles WHERE participant_id=?)"
      : "EXISTS(SELECT 1 FROM applicant_profiles WHERE participant_id=? AND json_valid(profile) AND trim(COALESCE(json_extract(profile,'$.first_name'),''))<>'' AND trim(COALESCE(json_extract(profile,'$.last_name'),''))<>'')";
    const result = await client.run(
      `INSERT OR IGNORE INTO profile_celebrations(participant_id,kind) SELECT ?,? WHERE ${guard}`,
      [participantId, kind, participantId],
    );
    return { data: { claimed: result.count === 1 }, error: null };
  }
  if (name === "set_home_language") {
    const language = String(args.p_language || "");
    if (!Object.hasOwn(HOME_LANGUAGES, language)) return { data: null, error: new Error("language_not_supported") };
    const result = await client.run(
      "UPDATE participants SET ui_language=?,language_selected_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND telegram_user_id=? AND status='active'",
      [language, args.p_user, args.p_telegram_user_id],
    );
    return result.count === 1 ? { data: { language }, error: null } : { data: null, error: new Error("language_user_not_found") };
  }
  if (name === "claim_applicant_completion_prompt") {
    const userId = String(args.p_user || "");
    const row = (await client.run("SELECT profile FROM applicant_profiles WHERE participant_id=? LIMIT 1", [userId]))[0];
    if (!row || missingApplicantFields(row.profile).length)
      return { data: { first_time: false, complete: false }, error: null };
    const claimed = await client.run(
      "INSERT OR IGNORE INTO applicant_completion_prompts(participant_id) SELECT ? WHERE EXISTS(SELECT 1 FROM participants WHERE id=? AND status='active')",
      [userId, userId],
    );
    return { data: { first_time: claimed.count === 1, complete: true }, error: null };
  }
  if (name === "reset_applicant_profile_and_pause_auto_apply") {
    const userId = String(args.p_user || "");
    const telegramId = Number(args.p_telegram_user_id);
    const token = String(args.p_confirmation_token || "");
    if (!userId || !Number.isSafeInteger(telegramId) || telegramId < 1 || !/^[a-f0-9]{12}$/.test(token))
      return { data: null, error: new Error("profile_reset_invalid") };

    const oldestAllowed = Date.now() - 10 * 60_000;
    const gate = `EXISTS (
      SELECT 1 FROM participants WHERE id=? AND telegram_user_id=? AND status='active'
        AND json_extract(telegram_state,'$._applicant_clear_token')=?
        AND CAST(json_extract(telegram_state,'$._applicant_clear_issued_at') AS INTEGER)>=?
    )`;
    const guard = [userId, telegramId, token, oldestAllowed];
    const results = await client.batch([
      {
        query: `UPDATE applicant_profiles
          SET profile=CASE WHEN json_valid(profile) THEN json_object(
            'message_apartment',json_extract(profile,'$.message_apartment'),
            'message_house',json_extract(profile,'$.message_house'))
            ELSE '{}' END,updated_at=CURRENT_TIMESTAMP
          WHERE participant_id=? AND ${gate}`,
        params: [userId, ...guard],
      },
      {
        query: `INSERT OR IGNORE INTO application_preferences(participant_id)
          SELECT ? WHERE ${gate}`,
        params: [userId, ...guard],
      },
      {
        query: `UPDATE application_preferences SET enabled=0,immoscout_enabled=0,
          immowelt_enabled=0,immomio_enabled=0,updated_at=CURRENT_TIMESTAMP
          WHERE participant_id=? AND ${gate}`,
        params: [userId, ...guard],
      },
      {
        query: `UPDATE participants SET auto_apply_enabled=0,test_auto_apply_enabled=0,
          test_auto_apply_disabled_at=CASE WHEN test_auto_apply_enabled=1 THEN CURRENT_TIMESTAMP
            ELSE test_auto_apply_disabled_at END,
          telegram_state=json_remove(telegram_state,
            '$._applicant_clear_token','$._applicant_clear_issued_at',
            '$._applicant_field','$._applicant_message_id','$._applicant_prompt_message_id'),
          updated_at=CURRENT_TIMESTAMP WHERE id=? AND ${gate}`,
        params: [userId, ...guard],
      },
    ]);
    if (Number(results?.[3]?.meta?.changes || 0) !== 1)
      return { data: null, error: new Error("profile_reset_confirmation_expired") };
    return { data: { cleared: true, auto_apply_paused: true }, error: null };
  }
  if (name === "set_telegram_auto_apply_sources") {
    const userId = String(args.p_user || "");
    const providerColumns = { immoscout24: "immoscout_enabled", immowelt: "immowelt_enabled", immomio: "immomio_enabled" };
    const provider = String(args.p_provider || "");
    if (provider && !Object.hasOwn(providerColumns, provider))
      return { data: null, error: new Error("provider_not_allowlisted") };
    const enable = args.p_enabled === true;
    const participant = (await client.run("SELECT id,status,telegram_user_id,test_auto_apply_allowed,test_auto_apply_enabled,auto_apply_enabled,plan_override,plan_override_expires_at,referral_bonus_until FROM participants WHERE id=? LIMIT 1", [userId]))[0];
    if (!participant || participant.status !== "active" || Number(participant.telegram_user_id) !== Number(args.p_telegram_user_id))
      return { data: null, error: new Error("auto_apply_user_not_found") };
    const current = (await client.run("SELECT immoscout_enabled,immowelt_enabled,immomio_enabled FROM application_preferences WHERE participant_id=? LIMIT 1", [userId]))[0] || {};
    const next = {
      immoscout_enabled: provider ? (provider === "immoscout24" ? enable : bool(current.immoscout_enabled)) : enable,
      immowelt_enabled: provider ? (provider === "immowelt" ? enable : bool(current.immowelt_enabled)) : enable,
      immomio_enabled: provider ? (provider === "immomio" ? enable : bool(current.immomio_enabled)) : enable,
    };
    const active = Object.values(next).some(Boolean);
    // The allowlisted owner's Start/Pause buttons operate the isolated test
    // flow. They must never also enable the normal application sender.
    if (bool(participant.test_auto_apply_allowed) && Number(participant.telegram_user_id) === 8538226539) {
      if (active && enable) {
        const missing = await rpc(client, env, "application_profile_missing_fields", { p_user: userId });
        if (missing.error || missing.data.length) return { data: null, error: new Error("profile_incomplete") };
      }
      const sourceId = { immoscout24: 1, immowelt: 4, immomio: 3 }[provider];
      const callbackData = provider
        ? `platforms:${enable ? "resume" : "pause"}:${sourceId}`
        : args.p_from_completion === true
          ? `platforms:completion:${enable ? "yes" : "no"}`
          : `platforms:${enable ? "on" : "off"}`;
      const superseding = provider
        ? [`platforms:resume:${sourceId}`, `platforms:pause:${sourceId}`]
        : ["platforms:on", "platforms:off", "platforms:completion:yes", "platforms:completion:no"];
      const order = telegramControlOrder(args, callbackData, superseding);
      if (order.error) return { data: null, error: order.error };
      const newlyActivated = active && (!bool(participant.test_auto_apply_enabled) ||
        (provider ? enable && !bool(current[providerColumns[provider]]) :
          enable && Object.entries(next).some(([key, value]) => value && !bool(current[key]))));
      const retired = !active ? null : provider && !enable ? provider : undefined;
      const results = await client.batch([
        { query: "INSERT OR IGNORE INTO application_preferences(participant_id) VALUES(?)", params: [userId] },
        ...(order.record ? [order.record] : []),
        { query: `UPDATE application_preferences SET immoscout_enabled=?,immowelt_enabled=?,immomio_enabled=?,enabled=0,updated_at=CURRENT_TIMESTAMP WHERE participant_id=?${order.sql}`,
          params: [next.immoscout_enabled ? 1 : 0, next.immowelt_enabled ? 1 : 0, next.immomio_enabled ? 1 : 0, userId, ...order.params] },
        { query: `UPDATE participants SET auto_apply_enabled=0,test_auto_apply_enabled=?,test_auto_apply_daily_limit=0,
          test_auto_apply_enabled_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE test_auto_apply_enabled_at END,
          test_auto_apply_disabled_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE test_auto_apply_disabled_at END,
          updated_at=CURRENT_TIMESTAMP WHERE id=?${order.sql}`,
          params: [active ? 1 : 0, newlyActivated ? 1 : 0, active ? 0 : 1, userId, ...order.params] },
        ...((retired !== undefined) ? [{
          query: `UPDATE applications SET status='failed',last_error='test_mode_disabled',updated_at=CURRENT_TIMESTAMP
            WHERE participant_id=? AND test_mode=1 AND status IN ('pending','processing')
              AND submission_started_at IS NULL${retired ? " AND provider=?" : ""}${order.sql}`,
          params: [...(retired ? [userId, retired] : [userId]), ...order.params],
        }] : []),
      ]);
      if (order.record && Number(results?.[1]?.meta?.changes || 0) !== 1)
        return { data: null, error: new Error("telegram_control_update_missing") };
      return { data: { enabled: active, test_mode: true, ...next }, error: null };
    }
    if (active) {
      if (bool(participant.test_auto_apply_enabled)) return { data: null, error: new Error("test_mode_active") };
      const profile = (await client.run("SELECT profile FROM applicant_profiles WHERE participant_id=? LIMIT 1", [userId]))[0];
      if (!profile || missingApplicantFields(profile.profile).length)
        return { data: null, error: new Error("profile_incomplete") };
      const activeSearch = (await client.run(
        "SELECT 1 AS found FROM search_profiles WHERE participant_id=? AND active=1 AND json_valid(criteria) AND json_extract(criteria,'$.location_mode') IS NOT NULL AND (json_extract(criteria,'$.property_types') IS NOT NULL OR json_extract(criteria,'$.property_type') IS NOT NULL) LIMIT 1",
        [userId],
      ))[0];
      if (!activeSearch) return { data: null, error: new Error("search_profile_missing") };
    }
    const sourceId = { immoscout24: 1, immowelt: 4, immomio: 3 }[provider];
    const callbackData = provider
      ? `platforms:${enable ? "resume" : "pause"}:${sourceId}`
      : args.p_from_completion === true
        ? `platforms:completion:${enable ? "yes" : "no"}`
        : `platforms:${enable ? "on" : "off"}`;
    const superseding = provider
      ? [`platforms:resume:${sourceId}`,`platforms:pause:${sourceId}`]
      : ["platforms:completion:yes","platforms:completion:no","platforms:on","platforms:off"];
    const order = telegramControlOrder(args, callbackData, superseding);
    if (order.error) return { data: null, error: order.error };
    await client.batch([
      { query: "INSERT OR IGNORE INTO application_preferences(participant_id) VALUES(?)", params: [userId] },
      ...(order.record ? [order.record] : []),
      { query: `UPDATE application_preferences SET immoscout_enabled=?,immowelt_enabled=?,immomio_enabled=?,enabled=?,updated_at=CURRENT_TIMESTAMP WHERE participant_id=?${order.sql}`,
        params: [next.immoscout_enabled ? 1 : 0, next.immowelt_enabled ? 1 : 0, next.immomio_enabled ? 1 : 0, active ? 1 : 0, userId, ...order.params] },
      { query: `UPDATE participants SET auto_apply_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?${order.sql}`,
        params: [active ? 1 : 0, userId, ...order.params] },
    ]);
    return { data: { enabled: active, ...next }, error: null };
  }
  if (name === "get_or_create_referral_code") {
    const participantId = String(args.p_user || "");
    if (!participantId) return { data: null, error: new Error("referral_user_missing") };
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = (await client.run("SELECT code FROM referral_codes WHERE participant_id=? LIMIT 1", [participantId]))[0];
      if (existing) return { data: existing, error: null };
      const code = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
      await client.run(
        "INSERT OR IGNORE INTO referral_codes(participant_id,code) SELECT ?,? WHERE EXISTS(SELECT 1 FROM participants WHERE id=?)",
        [participantId, code, participantId],
      );
    }
    const existing = (await client.run("SELECT code FROM referral_codes WHERE participant_id=? LIMIT 1", [participantId]))[0];
    return existing ? { data: existing, error: null } : { data: null, error: new Error("referral_code_unavailable") };
  }
  if (name === "redeem_referral_code") {
    const code = String(args.p_code || "").trim();
    if (!args.p_referred_user_id || !code) return { data: { status: "invalid_code" }, error: null };
    const owner = (await client.run("SELECT participant_id FROM referral_codes WHERE lower(code)=lower(?) AND active=1 LIMIT 1", [code]))[0];
    if (!owner) return { data: { status: "invalid_code" }, error: null };
    if (owner.participant_id === args.p_referred_user_id) return { data: { status: "self_referral" }, error: null };
    const existing = await client.run("SELECT id FROM referrals WHERE referred_participant_id=? LIMIT 1", [args.p_referred_user_id]);
    if (existing.length) return { data: { status: "already_registered" }, error: null };
    const added = await client.run(
      "INSERT INTO referrals(id,referrer_participant_id,referred_participant_id,status) SELECT ?,?,?,'registered' WHERE EXISTS (SELECT 1 FROM participants WHERE id=?) AND NOT EXISTS (SELECT 1 FROM search_profiles WHERE participant_id=?) ON CONFLICT(referred_participant_id) DO NOTHING",
      [crypto.randomUUID(), owner.participant_id, args.p_referred_user_id, args.p_referred_user_id, args.p_referred_user_id],
    );
    return { data: { status: added.count ? "registered" : "not_new_user", referrer_user_id: owner.participant_id }, error: null };
  }
  if (name === "get_bot_secret") { const map={telegram_bot_token_runtime:env.TELEGRAM_BOT_TOKEN,telegram_webhook_secret:env.TELEGRAM_WEBHOOK_SECRET,stripe_portal_url:env.STRIPE_PORTAL_URL}; return { data: map[args.secret_name] || null, error: map[args.secret_name] ? null : new Error("secret_unavailable") }; }
  if (name === "issue_portal_bootstrap_token") {
    const telegramUserId = Number(args.p_telegram_user_id || 0);
    if (telegramUserId !== 8538226539) return { data: null, error: new Error("bootstrap_forbidden") };
    const owner = (await client.run(
      "SELECT id,status FROM participants WHERE telegram_user_id=? LIMIT 1",
      [telegramUserId],
    ))[0];
    if (!owner || owner.status !== "active") return { data: null, error: new Error("bootstrap_forbidden") };
    const admin = (await client.run(
      "SELECT id,password_hash FROM portal_members WHERE lower(email)='arash@nexalabs.de' AND role='super_admin' AND active=1 LIMIT 1",
    ))[0];
    if (!admin) return { data: null, error: new Error("bootstrap_admin_missing") };
    if (!String(admin.password_hash || "").startsWith("migration_required$")) {
      return { data: null, error: new Error("bootstrap_already_complete") };
    }
    const random = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(random, (value) => value.toString(16).padStart(2, "0")).join("");
    // Match auth.js: sha256() uses unpadded base64url, not hexadecimal.
    const tokenHash = await sha256(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await client.run(
      "UPDATE bootstrap_tokens SET consumed_at=CURRENT_TIMESTAMP WHERE consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP",
    );
    await client.run(
      "INSERT INTO bootstrap_tokens(id,token_hash,expires_at) VALUES(?,?,?)",
      [crypto.randomUUID(), tokenHash, expiresAt],
    );
    return { data: { token, expires_at: expiresAt }, error: null };
  }
  if (name === "prepare_telegram_update") {
    const payload = args.p_payload || {};
    const from = payload.callback_query?.from || payload.message?.from;
    const chat = payload.callback_query?.message?.chat || payload.message?.chat;
    if (!from?.id || !chat?.id) return { data: null, error: new Error("telegram_identity_invalid") };
    const found = await client.run("SELECT * FROM participants WHERE telegram_user_id=? LIMIT 1", [from.id]);
    let user = found[0];
    if (user) {
      // A callback normally carries unchanged Telegram identity data. Avoid a
      // write and follow-up SELECT on every tap; keep the response up to date
      // in memory only when the identity actually changes.
      const next = {
        telegram_chat_id: Number(chat.id),
        username: from.username || null,
        first_name: from.first_name || user.first_name,
        last_name: from.last_name || user.last_name,
        language_code: from.language_code || user.language_code || null,
      };
      const changed = Object.keys(next).some(key =>
        (key === "telegram_chat_id"
          ? Number(user[key]) !== Number(next[key])
          : String(user[key] ?? "") !== String(next[key] ?? "")),
      );
      if (changed) {
        await client.run(
          "UPDATE participants SET telegram_chat_id=?,username=?,first_name=?,last_name=?,language_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          [next.telegram_chat_id,next.username,next.first_name,next.last_name,next.language_code,user.id],
        );
        user = { ...user, ...next };
      }
    } else {
      const id = crypto.randomUUID();
      await client.run(
        "INSERT INTO participants(id,first_name,last_name,username,telegram_user_id,telegram_chat_id,ui_language,language_code,last_start_at,origin,welcome_premium_granted_at,referral_bonus_until) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,'telegram',CURRENT_TIMESTAMP,strftime('%Y-%m-%dT%H:%M:%SZ','now','+30 days'))",
        [id, from.first_name || "Teilnehmer", from.last_name || "Unbekannt", from.username || null, from.id, chat.id, "de", from.language_code || null],
      );
      await client.run("INSERT OR IGNORE INTO application_preferences(participant_id) VALUES(?)", [id]);
      await client.run("INSERT OR IGNORE INTO usage_reset_credits(id,participant_id,grant_key,granted_by_telegram_user_id) VALUES(lower(hex(randomblob(16))),?,'starter:7d',0)", [id]);
      user = (await client.run("SELECT * FROM participants WHERE id=?", [id]))[0];
    }
    const subscription = (await client.run(
      "SELECT id,participant_id AS user_id,provider,stripe_customer_id,stripe_subscription_id,status,current_period_end,cancel_at_period_end,last_event_created,created_at,updated_at FROM user_subscriptions WHERE participant_id=? ORDER BY updated_at DESC LIMIT 1",
      [user.id],
    ))[0] || null;
    return {
      data: {
        claim: 1,
        is_new_user: !found[0],
        user: {
          ...user,
          chat_id: user.telegram_chat_id,
          is_active: user.status === "active",
          onboarding_state: JSON.parse(user.telegram_state || "{}"),
          onboarding_step: JSON.parse(user.telegram_state || "{}")._step || null,
          telegram_user_id: user.telegram_user_id,
        },
        subscription,
      },
      error: null,
    };
  }
  if (name === "finish_ui_update") return { data:true,error:null };
  if (name === "save_ui_state") { const state=args.p_state||{}; state._step=args.p_step; await client.run("UPDATE participants SET telegram_state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",[JSON.stringify(state),args.p_user]); return {data:state,error:null}; }
  if (name === "save_search_profile_ui") {
    const v = args.p_values || {};
    const slot = Number(v.profile_slot ?? 1);
    if (!Number.isInteger(slot) || slot < 1 || slot > 4) return { data: null, error: new Error("profile_slot_invalid") };
    if (!args.p_user) return { data: null, error: new Error("search_profile_user_missing") };
    if (slot > 1 && !await hasPremium(client, args.p_user))
      return { data: null, error: new Error("premium_required") };
    const criteria = { ...v };
    delete criteria.profile_slot;
    // Berlin has a separate source and must never be accidentally linked to
    // legacy Hamburg/Schleswig-Holstein profiles. Preserve their existing
    // source defaults; Berlin profiles connect only to Berlin MCP.
    const berlin = ["all_berlin", "berlin_boroughs", "berlin_localities"].includes(String(criteria.location_mode));
    const requested = Array.isArray(v.source_ids) ? v.source_ids.map(Number) : ALLOWLIST;
    const ids = berlin
      ? [72]
      : [...new Set(requested.filter(source => ALLOWLIST.includes(source) && source !== 72))];
    const statements = [
      {
        query: "INSERT INTO search_profiles(id,participant_id,profile_slot,criteria,active) VALUES(?,?,?,?,1) ON CONFLICT(participant_id,profile_slot) DO UPDATE SET criteria=excluded.criteria,active=1,updated_at=CURRENT_TIMESTAMP",
        params: [crypto.randomUUID(), args.p_user, slot, JSON.stringify(criteria)],
      },
      {
        query: "DELETE FROM source_links WHERE search_profile_id=(SELECT id FROM search_profiles WHERE participant_id=? AND profile_slot=? LIMIT 1)",
        params: [args.p_user, slot],
      },
      ...ids.map(source => ({
        query: "INSERT OR IGNORE INTO source_links(search_profile_id,source_id) SELECT id,? FROM search_profiles WHERE participant_id=? AND profile_slot=? LIMIT 1",
        params: [source, args.p_user, slot],
      })),
      {
        query: "UPDATE participants SET referral_bonus_until=datetime(CASE WHEN julianday(referral_bonus_until)>julianday('now') THEN referral_bonus_until ELSE 'now' END,'+30 days'),referral_bonus_days=referral_bonus_days+30,updated_at=CURRENT_TIMESTAMP WHERE id IN (SELECT referred_participant_id FROM referrals WHERE referred_participant_id=? AND status='registered' UNION SELECT referrer_participant_id FROM referrals WHERE referred_participant_id=? AND status='registered') AND EXISTS (SELECT 1 FROM referrals r JOIN participants p ON p.id=r.referrer_participant_id JOIN participants q ON q.id=r.referred_participant_id WHERE r.referred_participant_id=? AND r.status='registered')",
        params: [args.p_user, args.p_user, args.p_user],
      },
      {
        query: "UPDATE referrals SET status='rewarded',qualified_at=CURRENT_TIMESTAMP,rewarded_at=CURRENT_TIMESTAMP,premium_granted_until=(SELECT referral_bonus_until FROM participants WHERE id=?) WHERE referred_participant_id=? AND status='registered' AND EXISTS (SELECT 1 FROM participants WHERE id=referrals.referrer_participant_id) AND EXISTS (SELECT 1 FROM participants WHERE id=referrals.referred_participant_id)",
        params: [args.p_user, args.p_user],
      },
    ];
    const results = await client.batch(statements);
    const saved = (await client.run("SELECT id FROM search_profiles WHERE participant_id=? AND profile_slot=? LIMIT 1", [args.p_user, slot]))[0];
    return saved?.id
      ? { data: { id: saved.id, profile_slot: slot, status: Number(results.at(-1)?.meta?.changes || 0) ? "rewarded" : "none" }, error: null }
      : { data: null, error: new Error("search_profile_save_failed") };
  }
  if (name === "application_profile_missing_fields") {
    const row = (await client.run("SELECT profile FROM applicant_profiles WHERE participant_id=?", [args.p_user]))[0];
    return { data: missingApplicantFields(row?.profile), error: null };
  }
  if (name === "set_application_test_mode") {
    const enabled = args.p_enabled === true || args.p_enabled === 1;
    const telegramId = Number(args.p_telegram_user_id || 0);
    const user = (await client.run(
      "SELECT id,telegram_user_id,status,auto_apply_enabled,test_auto_apply_allowed,test_auto_apply_enabled,test_auto_apply_daily_limit FROM participants WHERE id=? AND telegram_user_id=? LIMIT 1",
      [args.p_user, telegramId],
    ))[0];
    if (!user || telegramId !== 8538226539 || user.status !== "active" || !bool(user.test_auto_apply_allowed)) {
      return { data: null, error: new Error("test_mode_forbidden") };
    }
    if (enabled) {
      if (bool(user.auto_apply_enabled)) return { data: null, error: new Error("test_mode_global_auto_apply_active") };
      const preferences = (await client.run("SELECT enabled FROM application_preferences WHERE participant_id=? LIMIT 1", [args.p_user]))[0];
      if (bool(preferences?.enabled)) return { data: null, error: new Error("test_mode_global_auto_apply_active") };
      const missingResult = await rpc(client, env, "application_profile_missing_fields", { p_user: args.p_user });
      if (missingResult.error || missingResult.data.length) return { data: null, error: new Error("test_mode_profile_incomplete") };
      const activeSearch = await client.run(
        "SELECT sp.id FROM search_profiles sp JOIN source_links sl ON sl.search_profile_id=sp.id WHERE sp.participant_id=? AND sp.active=1 AND sl.source_id IN (1,69,72) LIMIT 1",
        [args.p_user],
      );
      if (!activeSearch.length) return { data: null, error: new Error("test_mode_search_profile_missing") };
      const central = (await client.run(
        "SELECT account_hint,status,enabled,ciphertext,iv FROM central_credentials WHERE singleton='central' LIMIT 1",
      ))[0];
      if (!central || central.account_hint !== "arash@nexalabs.de" || central.status !== "connected" || bool(central.enabled) || !central.ciphertext || !central.iv) {
        return { data: null, error: new Error("test_mode_central_account_unavailable") };
      }
      await client.run(
        "UPDATE participants SET test_auto_apply_daily_limit=1,test_auto_apply_enabled=1,test_auto_apply_enabled_at=CURRENT_TIMESTAMP,test_auto_apply_disabled_at=NULL,test_auto_apply_updated_by_telegram_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [telegramId, args.p_user],
      );
    } else {
      await client.run(
        "UPDATE participants SET test_auto_apply_enabled=0,test_auto_apply_disabled_at=CURRENT_TIMESTAMP,test_auto_apply_updated_by_telegram_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [telegramId, args.p_user],
      );
      await client.run(
        "UPDATE applications SET status='failed',last_error='test_mode_disabled',updated_at=CURRENT_TIMESTAMP WHERE participant_id=? AND test_mode=1 AND status IN ('pending','processing') AND submission_started_at IS NULL",
        [args.p_user],
      );
    }
    const updated = (await client.run(
      "SELECT test_auto_apply_allowed,test_auto_apply_enabled,test_auto_apply_daily_limit,test_auto_apply_enabled_at,test_auto_apply_disabled_at FROM participants WHERE id=?",
      [args.p_user],
    ))[0];
    return { data: {
      allowed: bool(updated?.test_auto_apply_allowed),
      enabled: bool(updated?.test_auto_apply_enabled),
      daily_limit: Number(updated?.test_auto_apply_daily_limit || 1),
      enabled_at: updated?.test_auto_apply_enabled_at || null,
      disabled_at: updated?.test_auto_apply_disabled_at || null,
    }, error: null };
  }
  if (name === "set_application_enabled_shared") {
    const enabled = args.p_enabled === true || args.p_enabled === 1;
    const user = (await client.run("SELECT test_auto_apply_enabled FROM participants WHERE id=? LIMIT 1", [args.p_user]))[0];
    if (enabled && bool(user?.test_auto_apply_enabled)) return { data: null, error: new Error("test_mode_active") };
    const order = telegramControlOrder(args, enabled ? "platforms:on" : "platforms:off", ["platforms:on", "platforms:off"]);
    if (order.error) return { data: null, error: order.error };
    const results = await client.batch([
      { query: "INSERT OR IGNORE INTO application_preferences(participant_id) VALUES(?)", params: [args.p_user] },
      ...(order.record ? [order.record] : []),
      { query: `UPDATE application_preferences SET enabled=? WHERE participant_id=?${order.sql}`, params: [enabled ? 1 : 0, args.p_user, ...order.params] },
      { query: `UPDATE participants SET auto_apply_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?${order.sql}`, params: [enabled ? 1 : 0, args.p_user, ...order.params] },
    ]);
    if (order.record && Number(results?.[1]?.meta?.changes || 0) !== 1) return { data: null, error: new Error("telegram_control_update_missing") };
    return { data: { enabled }, error: null };
  }
  if (name === "set_application_provider_enabled_shared") {
    const col = { immoscout: "immoscout_enabled", immoscout24: "immoscout_enabled", immowelt: "immowelt_enabled", immomio: "immomio_enabled" }[args.p_provider];
    const source = { immoscout: 1, immoscout24: 1, immomio: 3, immowelt: 4 }[args.p_provider];
    if (!col) return { data: null, error: new Error("provider_not_allowlisted") };
    const enabled = args.p_enabled === true || args.p_enabled === 1;
    const callbackData = `platforms:${enabled ? "resume" : "pause"}:${source}`;
    const order = telegramControlOrder(args, callbackData, [`platforms:pause:${source}`, `platforms:resume:${source}`]);
    if (order.error) return { data: null, error: order.error };
    const results = await client.batch([
      { query: "INSERT OR IGNORE INTO application_preferences(participant_id) VALUES(?)", params: [args.p_user] },
      ...(order.record ? [order.record] : []),
      { query: `UPDATE application_preferences SET ${col}=? WHERE participant_id=?${order.sql}`, params: [enabled ? 1 : 0, args.p_user, ...order.params] },
    ]);
    if (order.record && Number(results?.[1]?.meta?.changes || 0) !== 1) return { data: null, error: new Error("telegram_control_update_missing") };
    return { data: { enabled }, error: null };
  }
  if (name === "get_schleswig_holstein_areas") {
    const row = (await client.run("SELECT payload FROM coach_geo_snapshot WHERE id='de-hh-sh' LIMIT 1"))[0];
    if (!row?.payload) return { data: null, error: new Error("geography_snapshot_missing") };
    const areas = json(row.payload, {}).schleswigHolsteinAreas;
    return Array.isArray(areas) && areas.length
      ? { data: areas, error: null }
      : { data: null, error: new Error("geography_snapshot_incomplete") };
  }
  return {data:null,error:null};
}
