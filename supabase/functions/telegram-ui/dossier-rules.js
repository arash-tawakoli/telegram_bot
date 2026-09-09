export const DOCUMENT_KINDS = {wbs:'WBS',schufa:'SCHUFA',rent_clearance:'Mietschuldenfreiheitsbescheinigung',guarantee:'Bürgschaft',income:'Einkommensnachweise',other:'Weitere Unterlagen'};
export const PROFILE_FIELDS = {full_name:'Vollständiger Name',email:'E-Mail',phone:'Telefon',occupation:'Beruf',income:'Monatliches Nettoeinkommen',household_size:'Haushaltsgröße',custom_application_text:'Bewerbungstext'};
export const FILE_LIMIT = 5 * 1024 * 1024;
export const validId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
export function privateApplicant(user, chat) {
    return chat?.type === 'private' && user.is_active && Number(chat.id) === Number(user.telegram_user_id) && Number(chat.id) === Number(user.chat_id);
}
export function profileValue(field, input) {
    if (!Object.hasOwn(PROFILE_FIELDS, field)) throw Error('Unbekanntes Feld.');
    const text = String(input || '').trim();
    if (text === '-') return null;
    const max = field === 'custom_application_text' ? 1500 : 120;
    if (!text || text.length > max) throw Error(`Bitte 1 bis ${max} Zeichen eingeben oder - zum Löschen.`);
    if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw Error('Bitte eine gültige E-Mail-Adresse eingeben.');
    if (field === 'income' || field === 'household_size') {
        const value = Number(text.replace(',', '.'));
        if (!Number.isFinite(value) || value < (field === 'income' ? 0 : 1) || value > (field === 'income' ? 1000000 : 30)
            || (field === 'household_size' && !Number.isInteger(value))) throw Error('Bitte einen gültigen Zahlenwert eingeben.');
        return value;
    }
    return text;
}
export function detectDocument(bytes) {
    if (!bytes.length || bytes.length > FILE_LIMIT) throw Error('Datei muss zwischen 1 Byte und 5 MB groß sein.');
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return 'application/pdf';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if ([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)) return 'image/png';
    throw Error('Bitte eine PDF-, JPG- oder PNG-Datei senden.');
}
export async function boundedFile(response) {
    if (!response.ok || !response.body) throw Error('Datei konnte nicht geladen werden.');
    if (Number(response.headers.get('content-length')) > FILE_LIMIT) throw Error('Datei ist größer als 5 MB.');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
        while (true) {
            const {done,value} = await reader.read(); if (done) break;
            size += value.length;
            if (size > FILE_LIMIT) { await reader.cancel(); throw Error('Datei ist größer als 5 MB.'); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset=0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
    return bytes;
}
