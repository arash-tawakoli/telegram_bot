import { db, send, esc, telegram } from './runtime.js';
import { applicationTarget, quickApplyButton, generateApplicationMessage } from './application-message.js';

export async function quickApplication(user, query) {
    const chat = query.message?.chat;
    // Never disclose a user's draft in a forwarded card or group conversation.
    if (chat?.type !== 'private' || Number(chat.id) !== Number(user.telegram_user_id)
        || Number(chat.id) !== Number(user.chat_id) || !user.is_active) return;
    const id = String(query.data || '').slice('apply:'.length);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return send(chat.id, 'Dieses Angebot ist nicht verfügbar.');
    }
    const { data: deliveries, error: deliveryError } = await db.from('delivery_events')
        .select('id').eq('recipient_user_id', user.id).eq('listing_id', id).eq('status', 'sent').limit(1);
    if (deliveryError) throw deliveryError;
    let owned = !!deliveries?.length;
    if (!owned && user.is_premium) {
        const { data: saved, error } = await db.from('saved_listings')
            .select('id').eq('user_id', user.id).eq('listing_id', id).limit(1);
        if (error) throw error;
        owned = !!saved?.length;
    }
    if (!owned) return send(chat.id, 'Bitte wähle eine dir zugestellte oder gespeicherte Wohnung.');
    const { data: listing, error } = await db.from('listings')
        .select('id,source_id,canonical_url,title,is_active').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!listing || !quickApplyButton(listing)) {
        return send(chat.id, 'Dieses Angebot ist inaktiv oder unterstützt keine Schnellbewerbung.');
    }
    const target = applicationTarget(listing);
    const message = generateApplicationMessage(user.is_premium ? {...user, ...user.applicant_profile} : user, listing);
    return telegram('sendMessage', {
        chat_id: chat.id,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        text: '⚡ <b>Schnell bewerben</b>\n\nNoch nicht versendet. Bitte Text und Namen prüfen. Dann Text kopieren, das Angebot öffnen und im Kontaktformular einfügen und absenden. Falls nötig, direkt bei der Plattform anmelden.\n\n'
        + `<pre>${esc(message)}</pre>\n\nDer Bot erhält keine Plattform-Passwörter und kann den manuellen Versand nicht bestätigen.`,
        reply_markup: { inline_keyboard: [
            ...(message.length <= 256 ? [[{ text: '📋 Bewerbungstext kopieren', copy_text: { text: message } }]] : []),
            [{ text: `${target.platform} öffnen`, url: target.url }],
        ] },
    });
}
