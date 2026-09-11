const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function applicationTarget(listing) {
    try {
        const url = new URL(listing.canonical_url);
        if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
        const scout = Number(listing.source_id) === 1
            && ['www.immobilienscout24.de', 'immobilienscout24.de'].includes(url.hostname)
            && /^\/expose\/\d+\/?$/.test(url.pathname);
        const klein = Number(listing.source_id) === 2
            && ['www.kleinanzeigen.de', 'kleinanzeigen.de'].includes(url.hostname)
            && /^\/s-anzeige\/[^/]+\/\d+-\d+-\d+\/?$/.test(url.pathname);
        if (!scout && !klein) return null;
        url.search = '';
        url.hash = '';
        return { platform: scout ? 'ImmoScout24' : 'Kleinanzeigen', url: url.href };
    } catch {
        return null;
    }
}

export function quickApplyButton(listing) {
    if (!UUID.test(listing.id || '') || listing.is_active === false) return null;
    return { text: '⚡ Schnellbewerbung', callback_data: `apply:${listing.id}` };
}

const singleLine = (value, max) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).replace(/[\uD800-\uDBFF]$/, '');

export function generateApplicationMessage(user, listing) {
    const title = singleLine(listing.title, 50) || 'Ihre Wohnung';
    const name = singleLine([user.first_name, user.last_name].filter(Boolean).join(' '), 40) || '[Dein Name]';
    return `Guten Tag,\n\nich interessiere mich für „${title}“ und würde die Wohnung gerne besichtigen. Über eine Rückmeldung freue ich mich.\n\nFreundliche Grüße\n${name}`;
}
