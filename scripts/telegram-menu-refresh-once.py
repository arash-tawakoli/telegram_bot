from pathlib import Path


def replace_exact(text: str, old: str, new: str, expected: int = 1) -> str:
    found = text.count(old)
    if found != expected:
        raise SystemExit(
            f"expected {expected} occurrence(s), found {found}: {old[:100]!r}"
        )
    return text.replace(old, new, expected)


ui_path = Path("supabase/functions/telegram-ui/index.ts")
ui = ui_path.read_text()

ui = replace_exact(
    ui,
    "const RENT_PRESETS = new Set([800, 1000, 1250, 1500]);",
    "const RENT_PRESETS = new Set([800, 1000, 1250, 2000]);",
)
ui = replace_exact(
    ui,
    "const AREA_PRESETS = new Set([30, 50, 70, 90]);",
    "const AREA_PRESETS = new Set([20, 50, 70, 90]);",
)

old_home_keyboard = '''function homeKeyboard(user: any) {
  const rows: any[] = [];
  if (user.onboarding_step) {
    rows.push([button("▶️ Entwurf fortsetzen", "draft")]);
  }
  rows.push(
    [button("🔎 Suchprofil", "profile")],
    [button("💾 Gespeichert", "saved")],
    [
      button("⚙️ Einstellungen", "settings"),
      button("❓ Hilfe", "help"),
    ],
    [
      button(
        user.is_premium ? "👑 Premium aktiv" : "👑 Premium",
        "premium",
      ),
    ],
  );
  return { inline_keyboard: rows };
}'''
new_home_keyboard = '''function homeKeyboard(user: any) {
  const rows: any[] = [];
  if (user.onboarding_step) {
    rows.push([button("▶️ Entwurf fortsetzen", "draft")]);
  }
  rows.push(
    [
      button("🔎 Suchprofil", "profile"),
      button("❤️ Gespeichert", "saved"),
    ],
    [
      button(
        user.is_premium ? "👑 Premium aktiv" : "👑 Premium",
        "premium",
      ),
      button("⚙️ Einstellungen", "settings"),
    ],
    [
      button("📡 Status", "status"),
      button("❓ Hilfe", "help"),
    ],
  );
  return { inline_keyboard: rows };
}'''
ui = replace_exact(ui, old_home_keyboard, new_home_keyboard)

old_help = '''const HELP_TEXT =
  "❓ <b>Hilfe</b>\\n\\n" +
  "/start – Startmenü\\n" +
  "/suche – Suchprofil erstellen oder ersetzen\\n" +
  "/profile – Suchprofil anzeigen\\n" +
  "/gespeichert – gespeicherte Inserate\\n" +
  "/einstellungen – Einstellungen\\n" +
  "/pause – Suche pausieren\\n" +
  "/resume – Suche fortsetzen\\n" +
  "/status – Systemstatus\\n" +
  "/premium – Premium anzeigen\\n" +
  "/hilfe – Hilfe";'''
new_help = '''const HELP_TEXT =
  "❓ <b>Hilfe & Befehle</b>\\n\\n" +
  "🏠 /start – Startmenü\\n" +
  "🔎 /suche – Suchprofil erstellen oder ersetzen\\n" +
  "👤 /profile – Suchprofil anzeigen\\n" +
  "❤️ /gespeichert – gespeicherte Inserate\\n" +
  "⚙️ /einstellungen – Einstellungen\\n" +
  "⏸ /pause – Suche pausieren\\n" +
  "▶️ /resume – Suche fortsetzen\\n" +
  "📡 /status – Systemstatus\\n" +
  "👑 /premium – Premium anzeigen\\n" +
  "❓ /hilfe – Hilfe";'''
ui = replace_exact(ui, old_help, new_help)

old_home = '''function home(user: any, chatId: number, messageId?: number) {
  const text =
    "🏠 <b>Traumwohnung Hamburg</b>\\n\\n" +
    "Die Bedienung läuft vollständig über Telegram-Befehle und Buttons.\\n\\n" +
    "Nutze /suche, um dein Suchprofil zu erstellen oder zu ersetzen.";
  return messageId
    ? edit(chatId, messageId, text, homeKeyboard(user))
    : send(chatId, text, homeKeyboard(user));
}'''
new_home = '''function home(user: any, chatId: number, messageId?: number) {
  const text =
    "🏠 <b>Traumwohnung Hamburg</b>\\n\\n" +
    "Finde passende Mietangebote in Hamburg – automatisch und direkt per Telegram.\\n\\n" +
    "Wähle unten, was du machen möchtest.";
  return messageId
    ? edit(chatId, messageId, text, homeKeyboard(user))
    : send(chatId, text, homeKeyboard(user));
}'''
ui = replace_exact(ui, old_home, new_home)

ui = replace_exact(
    ui,
    '[button("1.250 €", "rent:1250"), button("1.500 €", "rent:1500")],',
    '[button("1.250 €", "rent:1250"), button("2.000 €", "rent:2000")],',
)
ui = replace_exact(
    ui,
    '[button("30 m²", "area:30"), button("50 m²", "area:50")],',
    '[button("20 m²", "area:20"), button("50 m²", "area:50")],',
)
ui = replace_exact(
    ui,
    'button("✏️ Ersetzen", "new")',
    'button("✏️ Suchprofil ändern", "new")',
)

# Saved-listing visuals and generic return buttons.
ui = ui.replace("💾", "❤️")
ui = ui.replace(
    '[button("← Start", "home")]',
    '[button("← Zurück", "home")]',
)
ui = replace_exact(
    ui,
    'return acknowledge(query.id, savedState ? "Gespeichert" : "Entfernt");',
    'return acknowledge(query.id, savedState ? "❤️ Gespeichert" : "Entfernt");',
)

old_premium = '''async function premium(user: any, chatId: number, messageId?: number) {
  const rows: any[] = [];
  let text: string;
  if (user.is_premium) {
    text = "👑 <b>Premium aktiv</b>\\n\\nAlle Premium-Funktionen sind aktiv.";
    rows.push([button("💳 Abo verwalten", "portal")]);
  } else {
    text =
      "👑 <b>Traumwohnung Premium</b>\\n\\n" +
      "✅ Alle Quellen inkl. Baugenossenschaften\\n" +
      "✅ Sofortige Zustellung\\n" +
      "✅ Inserate speichern\\n\\n" +
      "<b>0,99 € / Monat</b>\\n" +
      "Keine Mindestlaufzeit · jederzeit kündbar";
    rows.push([
      {
        text: "👑 Premium freischalten",
        url: `${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(user.id)}`,
      },
    ]);
  }
  rows.push([button("← Zurück", "home")]);
  const markup = { inline_keyboard: rows };
  return messageId
    ? edit(chatId, messageId, text, markup)
    : send(chatId, text, markup);
}'''
new_premium = '''async function premium(user: any, chatId: number, messageId?: number) {
  const rows: any[] = [];
  let text: string;
  if (user.is_premium) {
    text =
      "👑 <b>Traumwohnung Premium</b>\\n\\n" +
      "✅ <b>Premium ist aktiv.</b>\\n\\n" +
      "<b>Deine Vorteile:</b>\\n" +
      "⚡ Sofortige Zustellung\\n" +
      "🏢 Alle Quellen inkl. Baugenossenschaften\\n" +
      "❤️ Inserate speichern";
    rows.push([button("💳 Abo verwalten", "portal")]);
  } else {
    text =
      "👑 <b>Traumwohnung Premium</b>\\n\\n" +
      "<b>Deine Vorteile:</b>\\n" +
      "⚡ Sofortige Zustellung\\n" +
      "🏢 Alle Quellen inkl. Baugenossenschaften\\n" +
      "❤️ Inserate speichern\\n\\n" +
      "<b>0,99 € / Monat</b>\\n" +
      "Keine Mindestlaufzeit · jederzeit kündbar";
    rows.push([
      {
        text: "👑 Premium freischalten",
        url: `${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(user.id)}`,
      },
    ]);
  }
  rows.push([button("← Zurück", "home")]);
  const markup = { inline_keyboard: rows };
  return messageId
    ? edit(chatId, messageId, text, markup)
    : send(chatId, text, markup);
}'''
ui = replace_exact(ui, old_premium, new_premium)

old_settings = '''async function settings(user: any, chatId: number, messageId?: number) {
  const text = "⚙️ <b>Einstellungen</b>\\n\\nDie Bedienung erfolgt über Befehle und Buttons.";
  const markup = {
    inline_keyboard: [
      [button("⏸ Pausieren", "pause"), button("▶️ Fortsetzen", "resume")],
      [button("👑 Premium", "premium")],
      [button("🎁 Freunde empfehlen", "referral")],
      [button("← Zurück", "home")],
    ],
  };
  return messageId
    ? edit(chatId, messageId, text, markup)
    : send(chatId, text, markup);
}'''
new_settings = '''async function settings(user: any, chatId: number, messageId?: number) {
  const text =
    "⚙️ <b>Einstellungen</b>\\n\\n" +
    "Verwalte hier deine Suche, Premium und Empfehlungen.";
  const markup = {
    inline_keyboard: [
      [
        button("⏸ Suche pausieren", "pause"),
        button("▶️ Suche fortsetzen", "resume"),
      ],
      [button("👑 Premium", "premium"), button("🎁 Freunde empfehlen", "referral")],
      [button("📡 Systemstatus", "status")],
      [button("← Zurück", "home")],
    ],
  };
  return messageId
    ? edit(chatId, messageId, text, markup)
    : send(chatId, text, markup);
}'''
ui = replace_exact(ui, old_settings, new_settings)

old_status = '''  const text =
    "📡 <b>Status</b>\\n\\n" +
    `Aktives Suchprofil: ${profileResult.count ? "ja" : "nein"}\\n` +
    `Aktive Quellen: ${sourceResult.count || 0}\\n` +
    "System: online";'''
new_status = '''  const text =
    "📡 <b>Systemstatus</b>\\n\\n" +
    `🔎 Suchprofil: ${profileResult.count ? "aktiv" : "inaktiv"}\\n` +
    `🌐 Aktive Quellen: ${sourceResult.count || 0}\\n` +
    "✅ System: online";'''
ui = replace_exact(ui, old_status, new_status)
ui_path.write_text(ui)

labels_path = Path("supabase/functions/notification-dispatcher/labels.ts")
labels = labels_path.read_text()
if labels.count('save: "⭐') < 1 or labels.count('saved: "✅') < 1:
    raise SystemExit("expected save/saved emoji labels not found")
labels = labels.replace('save: "⭐', 'save: "❤️')
labels = labels.replace('saved: "✅', 'saved: "❤️')
labels_path.write_text(labels)

webhook_path = Path("supabase/functions/stripe-webhook/index.ts")
webhook = webhook_path.read_text()
webhook = replace_exact(
    webhook,
    'const PAYMENT_LINK_ID = "plink_1UAdHZ2NorDNIWqIYpkB7lRq";',
    'const PAYMENT_LINK_ID = "plink_1UAy8Z2NorDNIWqI9h5j73q0";',
)

entitlement_block = '''        await applyEntitlement(
          userId,
          {
            stripe_customer_id: customerId,
            stripe_subscription_id: stripeId(object.subscription) || null,
            status: paid ? "active" : "incomplete",
            cancel_at_period_end: false,
          },
          eventCreated,
          false,
        );'''
activation_notice = entitlement_block + '''
        if (paid) {
          try {
            await telegramMessage(
              userId,
              "🎉 <b>Danke für dein Abo!</b>\\n\\n" +
                "👑 Dein Traumwohnung Premium-Abo ist jetzt aktiv.\\n\\n" +
                "<b>Ab sofort profitierst du von:</b>\\n" +
                "⚡ Sofortiger Zustellung neuer passender Inserate\\n" +
                "🏢 Allen Quellen inkl. Baugenossenschaften\\n" +
                "❤️ Inserate speichern\\n\\n" +
                "Viel Erfolg bei der Wohnungssuche! 🏠",
              {
                inline_keyboard: [[
                  { text: "🏠 Zum Menü", callback_data: "home" },
                ]],
              },
            );
          } catch (noticeError) {
            console.error("premium_activation_notice", noticeError);
          }
        }'''
webhook = replace_exact(webhook, entitlement_block, activation_notice)
webhook_path.write_text(webhook)
