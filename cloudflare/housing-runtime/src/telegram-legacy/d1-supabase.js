const TABLES = {
  bot_users: "participants",
  search_profiles: "search_profiles",
  applicant_profiles: "applicant_profiles",
  platform_connections: "provider_connections",
  platform_sessions: "portal_sessions",
  applicant_documents: "documents",
  listings: "offer_identities",
  delivery_events: "deliveries",
  applications: "applications",
  sources: "source_registry",
  application_preferences: "application_preferences",
  user_subscriptions: null,
  saved_listings: null,
  referral_codes: null,
  referrals: null,
  bot_events: null,
  platform_auth_flows: "provider_auth_flows",
  telegram_announcements: null,
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
};

const ALLOWLIST = [1, 3, 23, 29, 34, 35, 66, 69, 71];

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
  if (table === "application_preferences") return { ...row, user_id: row.participant_id, enabled: bool(row.enabled), immoscout_enabled: bool(row.immoscout_enabled), kleinanzeigen_enabled: bool(row.kleinanzeigen_enabled), immomio_enabled: bool(row.immomio_enabled), immowelt_enabled: bool(row.immowelt_enabled) };
  if (table === "sources") return { ...row, enabled: bool(row.enabled) };
  return row;
}

class Query {
  constructor(client, table) { this.client = client; this.table = table; this.physical = TABLES[table]; this.operation = "select"; this.selectSpec = "*"; this.filters = []; this.orders = []; this.limitValue = null; this.offsetValue = null; this.countMode = false; this.head = false; this.payload = null; this.returning = false; }
  select(spec = "*", options = {}) { if (this.operation === "insert" || this.operation === "upsert") this.returning = true; this.selectSpec = spec; this.countMode = options.count === "exact"; this.head = options.head === true; return this; }
  eq(column, value) { this.filters.push([mapColumn(this.table, column), "=", value]); return this; }
  neq(column, value) { this.filters.push([mapColumn(this.table, column), "<>", value]); return this; }
  gte(column, value) { this.filters.push([mapColumn(this.table, column), ">=", value]); return this; }
  lte(column, value) { this.filters.push([mapColumn(this.table, column), "<=", value]); return this; }
  is(column, value) { this.filters.push([mapColumn(this.table, column), value === null ? "IS" : "IS NOT", null]); return this; }
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
    if (kind === "UPDATE") { const entries=Object.entries(this.payload||{}); const params=entries.map(([,v])=>scalar(v)); const whereParams=[]; const where=this.where(whereParams); const sql=`UPDATE ${this.physical} SET ${entries.map(([k])=>`${mapColumn(this.table,k)}=?`).join(",")}${where?` WHERE ${where}`:""}`; const result=await this.client.run(sql,[...params,...whereParams]); return {data:[],error:null,count:result.count}; }
    const rows=this.payload||[]; let data=[]; for(const row of rows){const mapped={...row}; if(this.table==='bot_users'){mapped.telegram_chat_id=mapped.chat_id; delete mapped.chat_id; mapped.status=mapped.is_active===false?'archived':'active'; delete mapped.is_active; mapped.telegram_state=JSON.stringify(mapped.onboarding_state||{}); delete mapped.onboarding_state; delete mapped.onboarding_step;} if (this.table === "search_profiles") {
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
  return { from: table => new Query(client, table), rpc: async (name,args={}) => rpc(client, env, name, args), storage: { from: () => ({ remove: async () => ({ data: [], error: null }), upload: async () => ({ data: null, error: null }) }) } };
}

async function rpc(client, env, name, args) {
  if (name === "get_bot_secret") { const map={telegram_bot_token_runtime:env.TELEGRAM_BOT_TOKEN,telegram_webhook_secret:env.TELEGRAM_WEBHOOK_SECRET,stripe_portal_url:env.STRIPE_PORTAL_URL}; return { data: map[args.secret_name] || null, error: map[args.secret_name] ? null : new Error("secret_unavailable") }; }
  if (name === "prepare_telegram_update") {
    const payload = args.p_payload || {};
    const from = payload.callback_query?.from || payload.message?.from;
    const chat = payload.callback_query?.message?.chat || payload.message?.chat;
    if (!from?.id || !chat?.id) return { data: null, error: new Error("telegram_identity_invalid") };
    const found = await client.run("SELECT * FROM participants WHERE telegram_user_id=? LIMIT 1", [from.id]);
    let user = found[0];
    if (user) {
      await client.run(
        "UPDATE participants SET telegram_chat_id=?,username=?,first_name=COALESCE(?,first_name),last_name=COALESCE(?,last_name),ui_language=COALESCE(?,ui_language),updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [chat.id, from.username || null, from.first_name || null, from.last_name || null, from.language_code || null, user.id],
      );
      user = (await client.run("SELECT * FROM participants WHERE id=?", [user.id]))[0] || user;
    } else {
      const id = crypto.randomUUID();
      await client.run(
        "INSERT INTO participants(id,first_name,last_name,username,telegram_user_id,telegram_chat_id,ui_language,origin) VALUES(?,?,?,?,?,?,?,'telegram')",
        [id, from.first_name || "Teilnehmer", from.last_name || "Unbekannt", from.username || null, from.id, chat.id, from.language_code || "de"],
      );
      await client.run("INSERT OR IGNORE INTO application_preferences(participant_id) VALUES(?)", [id]);
      user = (await client.run("SELECT * FROM participants WHERE id=?", [id]))[0];
    }
    return {
      data: {
        claim: 1,
        is_new_user: !found[0],
        user: {
          ...user,
          chat_id: user.telegram_chat_id,
          is_active: user.status === "active",
          onboarding_state: JSON.parse(user.telegram_state || "{}"),
          onboarding_step: null,
          telegram_user_id: user.telegram_user_id,
        },
        subscription: null,
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
    const criteria = { ...v };
    delete criteria.profile_slot;
    const ids = Array.isArray(v.source_ids)
      ? [...new Set(v.source_ids.map(Number).filter(source => ALLOWLIST.includes(source)))]
      : ALLOWLIST;
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
    ];
    await client.batch(statements);
    const saved = (await client.run("SELECT id FROM search_profiles WHERE participant_id=? AND profile_slot=? LIMIT 1", [args.p_user, slot]))[0];
    return saved?.id
      ? { data: { id: saved.id, profile_slot: slot }, error: null }
      : { data: null, error: new Error("search_profile_save_failed") };
  }
  if (name === "application_profile_missing_fields") { const row=(await client.run("SELECT profile FROM applicant_profiles WHERE participant_id=?",[args.p_user]))[0]; const p=JSON.parse(row?.profile||"{}"); const missing=[]; for(const k of ["first_name","last_name","email","phone","street","house_number","postcode","city"])if(!String(p[k]||"").trim())missing.push(k); return {data:missing,error:null}; }
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
        "SELECT sp.id FROM search_profiles sp JOIN source_links sl ON sl.search_profile_id=sp.id WHERE sp.participant_id=? AND sp.active=1 AND sl.source_id IN (1,69) LIMIT 1",
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
        "UPDATE participants SET test_auto_apply_daily_limit=1,test_auto_apply_enabled=1,test_auto_apply_enabled_at=CURRENT_TIMESTAMP,test_auto_apply_disabled_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [args.p_user],
      );
    } else {
      await client.run(
        "UPDATE participants SET test_auto_apply_enabled=0,test_auto_apply_disabled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [args.p_user],
      );
      await client.run(
        "UPDATE applications SET status='failed',last_error='test_mode_disabled',updated_at=CURRENT_TIMESTAMP WHERE participant_id=? AND test_mode=1 AND status='pending'",
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
    await client.run("INSERT OR IGNORE INTO application_preferences(participant_id) VALUES(?)", [args.p_user]);
    await client.run("UPDATE application_preferences SET enabled=? WHERE participant_id=?", [enabled ? 1 : 0, args.p_user]);
    await client.run("UPDATE participants SET auto_apply_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [enabled ? 1 : 0, args.p_user]);
    return { data: { enabled }, error: null };
  }
  if (name === "set_application_provider_enabled_shared") { const col={immoscout:"immoscout_enabled",immoscout24:"immoscout_enabled",kleinanzeigen:"kleinanzeigen_enabled",immowelt:"immowelt_enabled",immomio:"immomio_enabled"}[args.p_provider]; if(!col)return{data:null,error:new Error("provider_not_allowlisted")}; await client.run(`INSERT OR IGNORE INTO application_preferences(participant_id) VALUES(?)`,[args.p_user]); await client.run(`UPDATE application_preferences SET ${col}=? WHERE participant_id=?`,[args.p_enabled?1:0,args.p_user]); return {data:{enabled:!!args.p_enabled},error:null}; }
  if (name === "get_schleswig_holstein_areas") return {data:[],error:null};
  return {data:null,error:null};
}
