import { hashPassword, memberForAccess, sha256 } from "./auth.js";
import { assertAllowedSource } from "./source-allowlist.js";
import { fetchImmoScoutSource, fetchImmoScoutMap, germanImmoScoutQuery } from "./immoscout-source.js";
import { issueProviderAuthFlow } from "./provider-facade.js";

const PORTAL_ORIGIN = "https://intern.traumwohnunghamburg.de";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function uuid(value, field = "id") {
  const result = String(value || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) throw new Error(`${field}_invalid`);
  return result;
}

function text(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function actorToken(request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

async function actor(sql, request) {
  const token = actorToken(request);
  const member = await memberForAccess(sql, token);
  if (member) return member;
  throw new Error("unauthorized");
}

function isAdmin(member) {
  return member.role === "admin" || member.role === "super_admin";
}

const PROVIDERS = new Set(["immoscout24", "immowelt", "immomio"]);

function provider(value) {
  const raw = String(value || "").toLowerCase();
  const result = raw === "immoscout" ? "immoscout24" : raw;
  if (!PROVIDERS.has(result)) throw new Error("provider_not_allowlisted");
  return result;
}

async function canAccessParticipant(sql, member, participantId) {
  if (isAdmin(member)) return true;
  const rows = await sql`
    SELECT 1 FROM housing.participant_assignments
    WHERE participant_id = ${participantId} AND member_id = ${member.id}
  `;
  return Boolean(rows[0]);
}

function safeFilename(value) {
  const name = text(value, 180).replace(/[^a-zA-Z0-9._-]+/g, "_");
  if (!name || name === "." || name === "..") throw new Error("filename_invalid");
  return name;
}

function validDocumentType(value) {
  const type = text(value, 60).toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(type)) throw new Error("document_type_invalid");
  return type;
}

function validMime(value) {
  const mime = text(value, 100).toLowerCase();
  if (!["application/pdf", "image/jpeg", "image/png"].includes(mime)) throw new Error("document_type_invalid");
  return mime;
}

async function participantRows(sql, member) {
  const rows = isAdmin(member)
    ? await sql`
        SELECT p.id, p.first_name, p.last_name, p.email, p.status, p.created_at,
          (SELECT count(*)::int FROM housing.search_profiles sp WHERE sp.participant_id = p.id) AS search_count,
          (SELECT count(*)::int FROM housing.documents d WHERE d.participant_id = p.id) AS document_count,
          (SELECT m.display_name FROM housing.participant_assignments pa JOIN housing.portal_members m ON m.id = pa.member_id WHERE pa.participant_id = p.id) AS coach
        FROM housing.participants p ORDER BY p.last_name, p.first_name
      `
    : await sql`
        SELECT p.id, p.first_name, p.last_name, p.email, p.status, p.created_at,
          (SELECT count(*)::int FROM housing.search_profiles sp WHERE sp.participant_id = p.id) AS search_count,
          (SELECT count(*)::int FROM housing.documents d WHERE d.participant_id = p.id) AS document_count,
          m.display_name AS coach
        FROM housing.participants p
        JOIN housing.participant_assignments pa ON pa.participant_id = p.id AND pa.member_id = ${member.id}
        JOIN housing.portal_members m ON m.id = pa.member_id
        ORDER BY p.last_name, p.first_name
      `;
  return rows.map((row) => ({
    participantId: row.id,
    status: row.status,
    participant: {
      participantId: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      name: [row.first_name, row.last_name].filter(Boolean).join(" "),
      email: row.email,
      isActive: row.status === "active",
    },
    coach: row.coach || "",
    searchProfileCount: Number(row.search_count || 0),
    documentCount: Number(row.document_count || 0),
    createdAt: row.created_at,
    readiness: {
      profileComplete: Boolean(row.first_name && row.last_name),
      searchProfileCount: Number(row.search_count || 0),
      providerCount: 0,
    },
  }));
}

async function participant(sql, member, id) {
  const participantId = uuid(id, "participant");
  if (!await canAccessParticipant(sql, member, participantId)) throw new Error("participant_forbidden");
  const [people, profiles, applicant, docs, connections, preferences] = await Promise.all([
    sql`SELECT id, first_name, last_name, email, status, created_at, updated_at FROM housing.participants WHERE id = ${participantId}`,
    sql`SELECT id, criteria, active, created_at, updated_at FROM housing.search_profiles WHERE participant_id = ${participantId} ORDER BY created_at`,
    sql`SELECT profile, updated_at FROM housing.applicant_profiles WHERE participant_id = ${participantId}`,
    sql`SELECT id, object_key, content_type, size_bytes, send_with_auto_apply, created_at FROM housing.documents WHERE participant_id = ${participantId} ORDER BY created_at DESC`,
    sql`SELECT provider, status, expires_at, updated_at FROM housing.provider_connections WHERE participant_id = ${participantId} ORDER BY provider`,
    sql`SELECT enabled, daily_limit, timezone, allowed_weekdays, send_window_start, send_window_end, immoscout_enabled, immowelt_enabled, immomio_enabled, updated_at FROM housing.application_preferences WHERE participant_id = ${participantId}`,
  ]);
  const person = people[0];
  if (!person) throw new Error("participant_not_found");
  return {
    participantId,
    user: { id: person.id, first_name: person.first_name, last_name: person.last_name, email: person.email, is_active: person.status === "active" },
    profile: applicant[0]?.profile || {},
    searchProfiles: profiles.map((row) => ({ id: row.id, ...row.criteria, active: row.active, created_at: row.created_at, updated_at: row.updated_at })),
    documents: docs,
    connections: connections.map((row) => ({ ...row, provider: row.provider === "immoscout24" ? "immoscout" : row.provider })),
    preferences: preferences[0] || null,
    applications: [],
    readiness: { profileComplete: Boolean(person.first_name && person.last_name), searchProfileCount: profiles.length, providerCount: connections.filter((row) => row.status === "connected").length },
  };
}

async function createParticipant(sql, member, body) {
  const participantId = crypto.randomUUID();
  const firstName = text(body.first_name, 120);
  const lastName = text(body.last_name, 120);
  const email = text(body.email, 320).toLowerCase() || null;
  if (!firstName || !lastName) throw new Error("profile_required");
  const assignedMemberId = body.coachMemberId ? uuid(body.coachMemberId, "coach_member") : member.id;
  if (!isAdmin(member) && assignedMemberId !== member.id) throw new Error("member_management_forbidden");
  await sql.begin(async (tx) => {
    await tx`INSERT INTO housing.participants (id, email, first_name, last_name) VALUES (${participantId}, ${email}, ${firstName}, ${lastName})`;
    await tx`INSERT INTO housing.applicant_profiles (participant_id, profile) VALUES (${participantId}, ${JSON.stringify({ phone: text(body.phone, 80), city: text(body.city, 120) })}::jsonb)`;
    await tx`INSERT INTO housing.participant_assignments (participant_id, member_id) VALUES (${participantId}, ${assignedMemberId})`;
  });
  return { ok: true, participantId };
}

async function updateProfile(sql, member, body) {
  const participantId = uuid(body.participantId, "participant");
  if (!await canAccessParticipant(sql, member, participantId)) throw new Error("participant_forbidden");
  await sql`
    INSERT INTO housing.applicant_profiles (participant_id, profile, updated_at)
    VALUES (${participantId}, ${JSON.stringify(body.profile || {})}::jsonb, now())
    ON CONFLICT (participant_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()
  `;
  return { ok: true };
}

async function saveSearch(sql, member, body) {
  const participantId = uuid(body.participantId, "participant");
  if (!await canAccessParticipant(sql, member, participantId)) throw new Error("participant_forbidden");
  const searchId = body.profileId ? uuid(body.profileId, "profile") : crypto.randomUUID();
  const profile = body.profile && typeof body.profile === "object" ? { ...body.profile } : {};
  const sourceIds = Array.isArray(profile.source_ids) ? profile.source_ids.map((id) => Number(id)) : [];
  for (const sourceId of sourceIds) assertAllowedSource(sourceId);
  delete profile.source_ids;
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO housing.search_profiles (id, participant_id, criteria, active)
      VALUES (${searchId}, ${participantId}, ${JSON.stringify(profile)}::jsonb, true)
      ON CONFLICT (id) DO UPDATE SET criteria = EXCLUDED.criteria, updated_at = now()
    `;
    await tx`DELETE FROM housing.source_links WHERE search_profile_id = ${searchId}`;
    for (const sourceId of sourceIds) await tx`INSERT INTO housing.source_links (search_profile_id, source_id) VALUES (${searchId}, ${sourceId})`;
  });
  return { ok: true, profileId: searchId };
}

async function dashboard(sql, member) {
  const [participants, applications, sent] = await Promise.all([
    sql`SELECT count(*)::int AS count FROM housing.participants WHERE status = 'active'`,
    sql`SELECT count(*)::int AS count FROM housing.applications`,
    sql`SELECT count(*)::int AS count FROM housing.applications WHERE status = 'sent'`,
  ]);
  const rows = await participantRows(sql, member);
  return { participants: rows.length, participantRows: rows, applications: Number(applications[0]?.count || 0), sent: Number(sent[0]?.count || 0), failed: 0, pending: 0, manualRequired: 0, recentApplications: [] };
}

function applicationRow(row) {
  return {
    id: row.id,
    status: row.status,
    last_error: row.last_error,
    wait_reason: row.wait_reason || null,
    created_at: row.created_at,
    sent_at: row.sent_at,
    participant: { participantId: row.participant_id, name: [row.first_name, row.last_name].filter(Boolean).join(" "), coach: row.coach || "" },
    listings: { title: "Wohnungsangebot", canonical_url: row.canonical_url, district: null, postal_code: null, city: null, sources: { name: row.source_name || "" } },
    latestEvent: row.event_id ? { provider: row.provider, event_type: row.event_type, status: row.event_status, reason: row.event_reason, document_result: row.document_result, created_at: row.event_created_at } : null,
  };
}

async function applicationPage(sql, member, body) {
  const scope = body.scope === "mine" && !isAdmin(member) ? member.id : null;
  const page = Math.max(1, Math.min(10_000, Number(body.page || 1)));
  const pageSize = Math.max(1, Math.min(100, Number(body.pageSize || 50)));
  const days = [7, 30, 90].includes(Number(body.days)) ? Number(body.days) : 30;
  const status = text(body.status, 40);
  const providerName = body.provider ? provider(body.provider) : "";
  if (providerName && !PROVIDERS.has(providerName)) throw new Error("provider_not_allowlisted");
  const rows = await sql`
    WITH latest_events AS (
      SELECT DISTINCT ON (ae.application_id)
        ae.application_id, ae.id AS event_id, ae.provider, ae.event_type, ae.status AS event_status,
        ae.reason AS event_reason, ae.document_result, ae.created_at AS event_created_at
      FROM housing.application_events ae
      ORDER BY ae.application_id, ae.created_at DESC
    )
    SELECT a.id, a.participant_id, a.status, a.last_error, a.created_at, a.updated_at,
      p.first_name, p.last_name, a.offer_identity_id, oi.canonical_url, sr.name AS source_name,
      pe.event_id, pe.provider, pe.event_type, pe.event_status, pe.event_reason, pe.document_result, pe.event_created_at,
      pm.display_name AS coach
    FROM housing.applications a
    JOIN housing.participants p ON p.id = a.participant_id
    JOIN housing.offer_identities oi ON oi.id = a.offer_identity_id
    JOIN housing.source_registry sr ON sr.id = oi.source_id
    LEFT JOIN latest_events pe ON pe.application_id = a.id
    LEFT JOIN housing.participant_assignments pa ON pa.participant_id = a.participant_id
    LEFT JOIN housing.portal_members pm ON pm.id = pa.member_id
    WHERE a.created_at >= now() - (${days} || ' days')::interval
      AND (${scope}::uuid IS NULL OR a.participant_id IN (SELECT participant_id FROM housing.participant_assignments WHERE member_id = ${scope}))
      AND (${status} = '' OR a.status = ${status})
      AND (${providerName} = '' OR a.provider = ${providerName})
    ORDER BY a.created_at DESC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `;
  const countRows = await sql`
    SELECT count(*)::int AS total FROM housing.applications a
    WHERE a.created_at >= now() - (${days} || ' days')::interval
      AND (${scope}::uuid IS NULL OR a.participant_id IN (SELECT participant_id FROM housing.participant_assignments WHERE member_id = ${scope}))
      AND (${status} = '' OR a.status = ${status})
      AND (${providerName} = '' OR a.provider = ${providerName})
  `;
  const total = Number(countRows[0]?.total || 0);
  return { applications: rows.map(applicationRow), total, page, pageSize, pages: Math.ceil(total / pageSize) };
}

async function applicationEvents(sql, member, body) {
  const applicationId = uuid(body.applicationId, "application");
  const rows = await sql`
    SELECT ae.provider, ae.event_type, ae.status, ae.attempt, ae.reason, ae.document_result, ae.metadata, ae.created_at
    FROM housing.application_events ae
    JOIN housing.applications a ON a.id = ae.application_id
    WHERE ae.application_id = ${applicationId}
      AND (${isAdmin(member)} OR a.participant_id IN (SELECT participant_id FROM housing.participant_assignments WHERE member_id = ${member.id}))
    ORDER BY ae.created_at
  `;
  return { events: rows };
}

async function setPreferences(sql, member, body) {
  const participantId = uuid(body.participantId, "participant");
  if (!await canAccessParticipant(sql, member, participantId)) throw new Error("participant_forbidden");
  const input = body.preferences && typeof body.preferences === "object" ? body.preferences : {};
  const weekdays = Array.isArray(input.allowed_weekdays) ? input.allowed_weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7) : null;
  await sql`
    INSERT INTO housing.application_preferences
      (participant_id, enabled, daily_limit, timezone, allowed_weekdays, send_window_start, send_window_end, immoscout_enabled, immowelt_enabled, immomio_enabled)
    VALUES
      (${participantId}, ${Boolean(input.enabled)}, ${input.daily_limit == null ? null : Number(input.daily_limit)}, ${text(input.timezone, 80) || "Europe/Berlin"}, ${weekdays}, ${input.send_window_start || null}, ${input.send_window_end || null}, ${Boolean(input.immoscout_enabled)}, ${Boolean(input.immowelt_enabled)}, ${Boolean(input.immomio_enabled)})
    ON CONFLICT (participant_id) DO UPDATE SET
      enabled = EXCLUDED.enabled, daily_limit = EXCLUDED.daily_limit, timezone = EXCLUDED.timezone,
      allowed_weekdays = EXCLUDED.allowed_weekdays, send_window_start = EXCLUDED.send_window_start,
      send_window_end = EXCLUDED.send_window_end, immoscout_enabled = EXCLUDED.immoscout_enabled,
      immowelt_enabled = EXCLUDED.immowelt_enabled, immomio_enabled = EXCLUDED.immomio_enabled, updated_at = now()
  `;
  return { ok: true };
}

async function startConnect(sql, member, body) {
  const participantId = uuid(body.participantId, "participant");
  if (!await canAccessParticipant(sql, member, participantId)) throw new Error("participant_forbidden");
  const selected = provider(body.provider);
  const flow = await issueProviderAuthFlow(sql, participantId, selected, "coach", "coach", {
    assignment_version: Number(body.assignmentVersion || 0),
    member_id: member.id,
  });
  return {
    status: "needs_login",
    provider: selected,
    ticket: flow.state,
    url: `https://login.traumwohnunghamburg.de/connect?ticket=${encodeURIComponent(flow.state)}`,
    expiresAt: flow.expiresAt,
  };
}

async function disconnectProvider(sql, member, body) {
  const participantId = uuid(body.participantId, "participant");
  if (!await canAccessParticipant(sql, member, participantId)) throw new Error("participant_forbidden");
  const selected = provider(body.provider);
  await sql`UPDATE housing.provider_connections SET status = 'disconnected', ciphertext = NULL, iv = NULL, updated_at = now() WHERE participant_id = ${participantId} AND provider = ${selected}`;
  return { ok: true, status: "disconnected" };
}

async function requestUpload(sql, member, body) {
  const participantId = uuid(body.participantId, "participant");
  if (!await canAccessParticipant(sql, member, participantId)) throw new Error("participant_forbidden");
  const filename = safeFilename(body.filename);
  const documentType = validDocumentType(body.document_type);
  const contentType = validMime(body.mime_type);
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const objectKey = `participants/${participantId}/${crypto.randomUUID()}-${filename}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await sql`
    INSERT INTO housing.upload_tokens (id, participant_id, token_hash, object_key, original_filename, document_type, content_type, expires_at)
    VALUES (gen_random_uuid(), ${participantId}, ${await sha256(token)}, ${objectKey}, ${filename}, ${documentType}, ${contentType}, ${expiresAt}::timestamptz)
  `;
  return { signedUrl: `${PORTAL_ORIGIN}/edge/documents/upload?token=${encodeURIComponent(token)}`, path: objectKey, filename, documentType };
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function registerUpload(sql, member, body) {
  const participantId = uuid(body.participantId, "participant");
  if (!await canAccessParticipant(sql, member, participantId)) throw new Error("participant_forbidden");
  const rows = await sql`
    SELECT id, object_key, original_filename, document_type, content_type, size_bytes
    FROM housing.upload_tokens
    WHERE participant_id = ${participantId} AND object_key = ${text(body.path, 500)}
      AND expires_at > now() AND uploaded_at IS NOT NULL AND consumed_at IS NULL
  `;
  if (!rows[0]) throw new Error("upload_not_found");
  const documentId = crypto.randomUUID();
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO housing.documents (id, participant_id, object_key, original_filename, document_type, content_type, size_bytes, send_with_auto_apply)
      VALUES (${documentId}, ${participantId}, ${rows[0].object_key}, ${rows[0].original_filename}, ${rows[0].document_type}, ${rows[0].content_type}, ${Number(rows[0].size_bytes || 0)}, ${Boolean(body.send_with_auto_apply)})
    `;
    await tx`UPDATE housing.upload_tokens SET consumed_at = now() WHERE id = ${rows[0].id}`;
  });
  return { ok: true, documentId };
}

async function openDocument(sql, member, body) {
  const participantId = uuid(body.participantId, "participant");
  const documentId = uuid(body.documentId, "document");
  if (!await canAccessParticipant(sql, member, participantId)) throw new Error("participant_forbidden");
  const rows = await sql`SELECT id FROM housing.documents WHERE id = ${documentId} AND participant_id = ${participantId}`;
  if (!rows[0]) throw new Error("document_not_found");
  return { url: `${PORTAL_ORIGIN}/edge/documents/open?document_id=${encodeURIComponent(documentId)}&participant_id=${encodeURIComponent(participantId)}` };
}

async function deleteDocument(sql, member, body, env) {
  const participantId = uuid(body.participantId, "participant");
  const documentId = uuid(body.documentId, "document");
  if (!await canAccessParticipant(sql, member, participantId)) throw new Error("participant_forbidden");
  const rows = await sql`SELECT object_key FROM housing.documents WHERE id = ${documentId} AND participant_id = ${participantId}`;
  if (!rows[0]) throw new Error("document_not_found");
  if (env.DOCUMENTS) await env.DOCUMENTS.delete(rows[0].object_key);
  await sql`DELETE FROM housing.documents WHERE id = ${documentId} AND participant_id = ${participantId}`;
  return { ok: true };
}

async function toggleDocument(sql, member, body) {
  const participantId = uuid(body.participantId, "participant");
  const documentId = uuid(body.documentId, "document");
  if (!await canAccessParticipant(sql, member, participantId)) throw new Error("participant_forbidden");
  await sql`UPDATE housing.documents SET send_with_auto_apply = ${Boolean(body.enabled)} WHERE id = ${documentId} AND participant_id = ${participantId}`;
  return { ok: true };
}

export async function handleCoach(sql, request, env = {}) {
  const member = await actor(sql, request, env);
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  if (action === "members") {
    if (!isAdmin(member)) throw new Error("admin_required");
    const rows = await sql.unsafe("SELECT m.id, m.display_name, m.role, m.active, m.created_at, (SELECT count(*) FROM housing.participant_assignments pa WHERE pa.member_id = m.id) AS participant_count FROM housing.portal_members m ORDER BY m.display_name");
    return { members: rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      role: row.role === "coach" ? "manager" : row.role,
      isActive: Boolean(row.active),
      createdAt: row.created_at,
      participantCount: Number(row.participant_count || 0),
    })) };
  }
  if (action === "update_coach_password") {
    if (!isAdmin(member)) throw new Error("admin_required");
    const memberId = uuid(body.memberId, "member");
    const password = String(body.password || "");
    if (password.length < 12 || password.length > 512) throw new Error("password_too_short");
    const targets = await sql.unsafe("SELECT id, role FROM housing.portal_members WHERE id = $1", [memberId]);
    const target = targets[0];
    const manageable = target && target.id !== member.id && target.role !== "super_admin"
      && (member.role === "super_admin" ? ["admin", "coach"].includes(target.role) : member.role === "admin" && target.role === "coach");
    if (!manageable) throw new Error("member_management_forbidden");
    const passwordHash = await hashPassword(password);
    const updated = await sql.unsafe("UPDATE housing.portal_members SET password_hash = $1, updated_at = now() WHERE id = $2 RETURNING id", [passwordHash, memberId]);
    if (!updated[0]) throw new Error("coach_password_update_failed");
    await sql.unsafe("UPDATE housing.portal_sessions SET revoked_at = now() WHERE member_id = $1 AND revoked_at IS NULL", [memberId]);
    return { ok: true };
  }
  if (action === "set_coach_active") {
    if (!isAdmin(member)) throw new Error("admin_required");
    const memberId = uuid(body.memberId, "member");
    const targets = await sql.unsafe("SELECT id, role FROM housing.portal_members WHERE id = $1", [memberId]);
    const target = targets[0];
    const manageable = target && target.id !== member.id && target.role !== "super_admin"
      && (member.role === "super_admin" ? ["admin", "coach"].includes(target.role) : member.role === "admin" && target.role === "coach");
    if (!manageable) throw new Error("member_management_forbidden");
    await sql.unsafe("UPDATE housing.portal_members SET active = $1, updated_at = now() WHERE id = $2", [Boolean(body.active), memberId]);
    if (!body.active) await sql.unsafe("UPDATE housing.portal_sessions SET revoked_at = now() WHERE member_id = $1 AND revoked_at IS NULL", [memberId]);
    return { ok: true };
  }
  if (action === "immoscout_search" || action === "immoscout_map") {
    // Both German MCP tools are read-only and require an authenticated portal member.
    const source = assertAllowedSource(body.sourceId);
    const query = germanImmoScoutQuery(source, body.query);
    const limit = Number(body.limit ?? (action === "immoscout_map" ? 100 : 25));
    const maximum = action === "immoscout_map" ? 200 : 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > maximum) throw new Error("immoscout_limit_invalid");
    if (action === "immoscout_map") return fetchImmoScoutMap(source, { query, limit });
    const result = await fetchImmoScoutSource(source, { query });
    const entries = result.nodes.slice(0, limit).map((node) => ({
      id: node.identity, url: node.canonical_url, ...node.facts,
    }));
    return {
      sourceId: source.id, tool: "property_search_de", query,
      total: result.reported_total ?? result.fetched,
      count: entries.length, entries,
    };
  }
  if (action === "me") return { member: { id: member.id, displayName: member.display_name, role: member.role }, workspace: { name: "TraumWohnungHamburg" } };
  if (action === "participants") return { participants: await participantRows(sql, member) };
  if (action === "participant") return participant(sql, member, body.participantId);
  if (action === "create_participant") return createParticipant(sql, member, body);
  if (action === "update_profile") return updateProfile(sql, member, body);
  if (action === "save_search") return saveSearch(sql, member, body);
  if (action === "set_search_active") {
    const participantId = uuid(body.participantId, "participant");
    if (!await canAccessParticipant(sql, member, participantId)) throw new Error("participant_forbidden");
    await sql`UPDATE housing.search_profiles SET active = ${Boolean(body.active)}, updated_at = now() WHERE id = ${uuid(body.profileId, "profile")} AND participant_id = ${participantId}`;
    return { ok: true };
  }
  if (action === "delete_search") {
    const participantId = uuid(body.participantId, "participant");
    if (!await canAccessParticipant(sql, member, participantId)) throw new Error("participant_forbidden");
    await sql`DELETE FROM housing.search_profiles WHERE id = ${uuid(body.profileId, "profile")} AND participant_id = ${participantId}`;
    return { ok: true };
  }
  if (action === "dashboard") return dashboard(sql, member);
  if (action === "set_preferences") return setPreferences(sql, member, body);
  if (action === "start_connect") return startConnect(sql, member, body);
  if (action === "disconnect_provider") return disconnectProvider(sql, member, body);
  if (action === "request_upload") return requestUpload(sql, member, body);
  if (action === "register_upload") return registerUpload(sql, member, body);
  if (action === "open_document") return openDocument(sql, member, body);
  if (action === "delete_document") return deleteDocument(sql, member, body, env);
  if (action === "toggle_document") return toggleDocument(sql, member, body);
  if (action === "applications") return applicationPage(sql, member, body);
  if (action === "application_events") return applicationEvents(sql, member, body);
  throw new Error("invalid_action");
}

export { actorToken };
