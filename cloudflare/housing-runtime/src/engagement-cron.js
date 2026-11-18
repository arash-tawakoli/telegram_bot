const CAMPAIGNS = {
  profile24: "profile_reminder_24h",
  profile72: "profile_reminder_72h",
  platform24: "platform_reminder_24h",
  autoApply3d: "autoapply_reminder_3d",
  feedback7: "feedback_day7",
  premium14: "premium_day14",
  premium30: "premium_day30",
  reactivation21: "reactivation_day21",
};

const MATERIALIZE = `
WITH eligible AS (
  SELECT p.id,p.created_at,p.last_start_at,p.last_activity_at,p.telegram_user_id,p.auto_apply_enabled,
    CASE
      WHEN p.plan_override='free' THEN 0
      WHEN p.plan_override='premium' AND (p.plan_override_expires_at IS NULL OR julianday(p.plan_override_expires_at)>julianday($1)) THEN 1
      WHEN p.referral_bonus_until IS NOT NULL AND julianday(p.referral_bonus_until)>julianday($1) THEN 1
      WHEN EXISTS (
        SELECT 1 FROM user_subscriptions s WHERE s.participant_id=p.id AND s.provider='stripe'
          AND s.status IN ('active','trialing') AND (s.current_period_end IS NULL OR julianday(s.current_period_end)>julianday($1))
      ) THEN 1
      ELSE 0
    END AS premium
  FROM participants p
  WHERE p.status='active' AND p.telegram_chat_id IS NOT NULL AND p.engagement_notifications_enabled=1
), profiles AS (
  SELECT participant_id,MIN(created_at) AS first_created FROM search_profiles WHERE active=1 GROUP BY participant_id
), connected AS (
  SELECT participant_id,MAX(updated_at) AS last_connected FROM provider_connections WHERE status='connected' GROUP BY participant_id
), candidates(participant_id,campaign_key,scheduled_at) AS (
  SELECT e.id,'profile_reminder_24h',strftime('%Y-%m-%dT%H:%M:%fZ',e.created_at)
  FROM eligible e WHERE julianday(e.created_at)<=julianday($1,'-24 hours')
    AND NOT EXISTS (SELECT 1 FROM search_profiles p WHERE p.participant_id=e.id AND p.active=1)
  UNION ALL
  SELECT e.id,'profile_reminder_72h',strftime('%Y-%m-%dT%H:%M:%fZ',datetime(e.created_at,'+72 hours'))
  FROM eligible e WHERE julianday(e.created_at)<=julianday($1,'-72 hours')
    AND NOT EXISTS (SELECT 1 FROM search_profiles p WHERE p.participant_id=e.id AND p.active=1)
    AND EXISTS (SELECT 1 FROM user_engagement_notifications n WHERE n.participant_id=e.id AND n.campaign_key='profile_reminder_24h' AND n.status='sent' AND julianday(n.sent_at)<=julianday($1,'-48 hours'))
  UNION ALL
  SELECT e.id,'platform_reminder_24h',strftime('%Y-%m-%dT%H:%M:%fZ',datetime(p.first_created,'+24 hours'))
  FROM eligible e JOIN profiles p ON p.participant_id=e.id
  WHERE e.premium=1 AND julianday(p.first_created)<=julianday($1,'-24 hours')
    AND NOT EXISTS (SELECT 1 FROM provider_connections c WHERE c.participant_id=e.id AND c.status='connected')
  UNION ALL
  SELECT e.id,'autoapply_reminder_3d',strftime('%Y-%m-%dT%H:%M:%fZ',datetime(c.last_connected,'+72 hours'))
  FROM eligible e JOIN connected c ON c.participant_id=e.id
  WHERE e.premium=1 AND e.auto_apply_enabled=0 AND julianday(c.last_connected)<=julianday($1,'-72 hours')
  UNION ALL
  SELECT e.id,'feedback_day7',strftime('%Y-%m-%dT%H:%M:%fZ',datetime(p.first_created,'+7 days'))
  FROM eligible e JOIN profiles p ON p.participant_id=e.id WHERE julianday(p.first_created)<=julianday($1,'-7 days')
  UNION ALL
  SELECT e.id,'premium_day14',strftime('%Y-%m-%dT%H:%M:%fZ',datetime(p.first_created,'+14 days'))
  FROM eligible e JOIN profiles p ON p.participant_id=e.id WHERE e.premium=0 AND julianday(p.first_created)<=julianday($1,'-14 days')
  UNION ALL
  SELECT e.id,'premium_day30',strftime('%Y-%m-%dT%H:%M:%fZ',datetime(p.first_created,'+30 days'))
  FROM eligible e JOIN profiles p ON p.participant_id=e.id WHERE e.premium=0 AND julianday(p.first_created)<=julianday($1,'-30 days')
  UNION ALL
  SELECT e.id,'reactivation_day21',strftime('%Y-%m-%dT%H:%M:%fZ',datetime(MAX(e.created_at,COALESCE(e.last_start_at,e.created_at)),'+21 days'))
  FROM eligible e JOIN profiles p ON p.participant_id=e.id
  WHERE julianday(MAX(e.created_at,COALESCE(e.last_start_at,e.created_at)))<=julianday($1,'-21 days')
    AND (e.last_activity_at IS NULL OR julianday(e.last_activity_at)<=julianday($1,'-21 days'))
  UNION ALL
  SELECT e.id,$2,$1
  FROM eligible e JOIN profiles p ON p.participant_id=e.id
  WHERE julianday(e.created_at)<=julianday($1,'-45 days')
    AND (e.last_activity_at IS NULL OR julianday(e.last_activity_at)<=julianday($1,'-30 days'))
    AND NOT EXISTS (SELECT 1 FROM user_engagement_notifications n WHERE n.participant_id=e.id AND n.campaign_key LIKE 'reactivation_%' AND n.sent_at IS NOT NULL AND julianday(n.sent_at)>julianday($1,'-30 days'))
)
INSERT INTO user_engagement_notifications(id,participant_id,campaign_key,scheduled_at,available_at)
SELECT lower(hex(randomblob(16))),c.participant_id,c.campaign_key,c.scheduled_at,
  CASE WHEN julianday(c.scheduled_at)>julianday($1) THEN c.scheduled_at ELSE $1 END
FROM candidates c
WHERE NOT EXISTS (SELECT 1 FROM user_engagement_notifications n WHERE n.participant_id=c.participant_id AND n.campaign_key=c.campaign_key)
ORDER BY julianday(c.scheduled_at),c.participant_id
LIMIT 200
ON CONFLICT(participant_id,campaign_key) DO NOTHING
RETURNING id`;

function dateValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError("engagement_time_invalid");
  return date;
}

function monthlyCampaign(date) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" }).formatToParts(date);
  return `reactivation_monthly_${parts.find((part) => part.type === "year").value}${parts.find((part) => part.type === "month").value}`;
}

export function messageFor(campaignKey) {
  const messages = {
    profile_reminder_24h: ["🔎 <b>Suchprofil anlegen</b>\n\nLege dein Suchprofil an, damit wir passende Wohnungsangebote für dich finden können.", [[{ text: "🔎 Suchprofil anlegen", callback_data: "new" }]]],
    profile_reminder_72h: ["🔎 <b>Deine Suche ist noch nicht eingerichtet</b>\n\nOhne Suchprofil können wir keine passenden Angebote für dich auswählen.", [[{ text: "Jetzt einrichten", callback_data: "new" }]]],
    platform_reminder_24h: ["🔗 <b>Plattform verbinden</b>\n\nDein Suchprofil ist bereit. Verbinde jetzt eine Plattform, damit die automatische Bewerbung eingerichtet werden kann.", [[{ text: "🔗 Plattform verbinden", callback_data: "platforms" }]]],
    autoapply_reminder_3d: ["⚡ <b>AutoApply aktivieren</b>\n\nAktiviere AutoApply, damit passende Bewerbungen automatisch über deine verbundenen Plattformen versendet werden können.", [[{ text: "⚡ AutoApply aktivieren", callback_data: "platforms:on" }]]],
    feedback_day7: ["💬 <b>Kurze Rückmeldung?</b>\n\nWie läuft deine Wohnungssuche bisher?", [[{ text: "👍 Alles gut", callback_data: "engagement:feedback:good" }], [{ text: "🔧 Optimieren", callback_data: "engagement:feedback:improve" }], [{ text: "⚠️ Problem melden", callback_data: "engagement:feedback:problem" }]]],
    premium_day14: ["💎 <b>Mehr aus deiner Wohnungssuche machen</b>\n\nMit Premium erhältst du:\n\n✅ automatische Bewerbungen auf passende Angebote\n✅ bis zu 4 Suchprofile statt 1 im Free-Tarif\n✅ weniger manuelle Schritte bei der Wohnungssuche\n✅ automatisierte Verarbeitung über verbundene Plattformen", [[{ text: "💎 Premium-Vorteile ansehen", callback_data: "premium" }]]],
    premium_day30: ["💎 <b>Deine Suche kann noch einfacher werden</b>\n\nPremium übernimmt mehr Arbeit für dich:\n\n🤖 passende Bewerbungen automatisch versenden\n🔎 bis zu 4 Suchprofile statt 1 im Free-Tarif verwalten\n⚡ weniger Angebote manuell bearbeiten\n🔗 verbundene Plattformen automatisiert nutzen", [[{ text: "Premium aktivieren", callback_data: "premium" }]]],
    reactivation_day21: ["🏠 <b>Deine Wohnungssuche wartet</b>\n\nDein Suchprofil ist noch aktiv. Prüfe kurz, ob deine Suchkriterien weiterhin passen.", [[{ text: "🔎 Suchprofil öffnen", callback_data: "profile" }]]],
  };
  const value = messages[campaignKey] || (String(campaignKey).startsWith("reactivation_monthly_") ? ["🏠 <b>Suche fortsetzen?</b>\n\nMöchtest du deine Wohnungssuche wieder aufnehmen?", [[{ text: "🔎 Suche öffnen", callback_data: "profile" }]]] : null);
  return value ? { text: value[0], rows: value[1] } : null;
}

export function isPremium(user, subscription, now = Date.now()) {
  if (user?.plan_override === "free") return false;
  const future = value => value && Date.parse(value) > now;
  if (user?.plan_override === "premium" && (!user.plan_override_expires_at || future(user.plan_override_expires_at))) return true;
  if (future(user?.referral_bonus_until)) return true;
  return !!subscription && ["active", "trialing"].includes(String(subscription.status)) && (!subscription.current_period_end || future(subscription.current_period_end));
}

export async function materializeEngagementNotifications(sql, now = new Date()) {
  const time = dateValue(now).toISOString();
  const rows = await sql.unsafe(MATERIALIZE, [time, monthlyCampaign(new Date(time))]);
  return rows.length;
}

function clean(value, max = 240) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

async function sendTelegram(botToken, chatId, campaign, fetchImpl) {
  const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: Number(chatId), text: campaign.text, parse_mode: "HTML", disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [...campaign.rows, [{ text: "🔕 Keine weiteren Erinnerungen", callback_data: "engagement:stop" }]] },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(`telegram_${data?.error_code || response.status}`);
}

export async function processEngagementNotifications(sql, env, now = new Date(), fetchImpl = fetch) {
  const at = dateValue(now);
  const nowIso = at.toISOString();
  const botToken = String(env.TELEGRAM_BOT_TOKEN || "");
  if (!botToken) throw new Error("telegram_token_missing");
  const staleAt = new Date(at.getTime() - 15 * 60_000).toISOString();
  await sql`UPDATE user_engagement_notifications SET status='pending',claimed_at=NULL,updated_at=${nowIso} WHERE status='processing' AND claimed_at<${staleAt}`;
  const rows = await sql`
    SELECT n.id,n.participant_id,n.campaign_key,n.attempts,p.telegram_chat_id,p.status AS participant_status,
      p.engagement_notifications_enabled,p.plan_override,p.plan_override_expires_at,p.referral_bonus_until,
      s.status AS subscription_status,s.current_period_end
    FROM user_engagement_notifications n
    LEFT JOIN participants p ON p.id=n.participant_id
    LEFT JOIN user_subscriptions s ON s.participant_id=p.id AND s.provider='stripe'
    WHERE n.status='pending' AND julianday(n.available_at)<=julianday(${nowIso})
    ORDER BY julianday(n.scheduled_at),julianday(n.created_at) LIMIT 40`;
  if (!rows.length) return { queued: 0, sent: 0, cancelled: 0, failed: 0, deferred: 0 };
  const ids = [...new Set(rows.map(row => String(row.participant_id)))];
  const markers = ids.map((_,index)=>`$${index+1}`).join(",");
  const recent = await sql.unsafe(`SELECT participant_id,MAX(sent_at) AS sent_at FROM user_engagement_notifications WHERE status='sent' AND sent_at IS NOT NULL AND participant_id IN (${markers}) AND julianday(sent_at)>=julianday($${ids.length+1}) GROUP BY participant_id`, [...ids,new Date(at.getTime()-7*86400_000).toISOString()]);
  const recentlySent = new Map(recent.map(row=>[String(row.participant_id),String(row.sent_at)]));
  let sent=0,cancelled=0,failed=0,deferred=0;
  for (const row of rows) {
    const user={plan_override:row.plan_override,plan_override_expires_at:row.plan_override_expires_at,referral_bonus_until:row.referral_bonus_until};
    const subscription={status:row.subscription_status,current_period_end:row.current_period_end};
    const campaign=messageFor(String(row.campaign_key));
    const key=String(row.campaign_key);
    // Premium-feature reminders need premium; premium upsells (premium_*) only make sense for free users.
    const premiumCampaign=key===CAMPAIGNS.autoApply3d||key===CAMPAIGNS.platform24;
    const upsell=key.startsWith("premium_");
    const premium=isPremium(user,subscription,at.getTime());
    if (!row.participant_id||!row.telegram_chat_id||Number(row.telegram_chat_id)<=0||row.participant_status!=="active"||!Number(row.engagement_notifications_enabled)||!campaign||(premiumCampaign&&!premium)||(upsell&&premium)) {
      await sql`UPDATE user_engagement_notifications SET status='cancelled',updated_at=${nowIso},last_error='not_eligible' WHERE id=${row.id} AND status='pending'`;
      cancelled++;
      continue;
    }
    const previous=recentlySent.get(String(row.participant_id));
    if (previous) {
      const available=new Date(Math.max(at.getTime()+60_000,Date.parse(previous)+7*86400_000)).toISOString();
      await sql`UPDATE user_engagement_notifications SET available_at=${available},updated_at=${nowIso},last_error='paced_7d' WHERE id=${row.id} AND status='pending'`;
      deferred++;
      continue;
    }
    const attempts=Number(row.attempts||0)+1;
    const claim=await sql`UPDATE user_engagement_notifications SET status='processing',attempts=${attempts},claimed_at=${nowIso},updated_at=${nowIso},last_error=NULL WHERE id=${row.id} AND status='pending' RETURNING id`;
    if (!claim.length) continue;
    try {
      await sendTelegram(botToken,row.telegram_chat_id,campaign,fetchImpl);
      await sql`UPDATE user_engagement_notifications SET status='sent',sent_at=${nowIso},updated_at=${nowIso},last_error=NULL WHERE id=${row.id}`;
      recentlySent.set(String(row.participant_id),nowIso);
      sent++;
    } catch (error) {
      const errorMessage=clean(error?.message||error);
      const terminal=attempts>=5||/telegram_(400|403)\b/.test(errorMessage);
      const available=new Date(at.getTime()+Math.min(attempts*5,30)*60_000).toISOString();
      await sql`UPDATE user_engagement_notifications SET status=${terminal?"failed":"pending"},available_at=${available},updated_at=${nowIso},last_error=${errorMessage} WHERE id=${row.id}`;
      failed++;
    }
  }
  return { queued: rows.length, sent, cancelled, failed, deferred };
}

export async function runEngagementNotifications(sql, env, now = new Date(), fetchImpl = fetch) {
  const materialized=await materializeEngagementNotifications(sql,now);
  const result=await processEngagementNotifications(sql,env,now,fetchImpl);
  return { materialized,...result };
}
