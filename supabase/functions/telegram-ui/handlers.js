import { handleMessage as baseHandleMessage, handleCallback as baseHandleCallback } from './handlers-base.js';
import { premium, toggleSave } from './navigation.js';
import { telegram, acknowledge } from './runtime.js';

export const handleMessage = baseHandleMessage;

export async function handleCallback(query, user) {
    const data = String(query.data || '');
    if (!data.startsWith('save:')) return baseHandleCallback(query, user);
    const chatId = Number(query.message?.chat.id);
    const messageId = Number(query.message?.message_id);
    const ack = (text) => user.__callback_acked ? Promise.resolve() : acknowledge(query.id, text);
    if (!chatId || !messageId) return ack();
    const savedState = await toggleSave(user, data.slice(5));
    if (savedState !== null && user.__callback_acked) {
        try {
            const markup = structuredClone(query.message?.reply_markup || {});
            let changed = false;
            for (const row of markup.inline_keyboard || []) for (const item of row || []) {
                if (item?.callback_data === data) {
                    item.text = savedState ? '❤️ Gespeichert' : '❤️ Speichern';
                    changed = true;
                }
            }
            if (changed) await telegram('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: markup });
        } catch (error) { console.error('save_button_refresh', String(error)); }
    }
    if (savedState === null) {
        EdgeRuntime.waitUntil(ack());
        return premium(user, chatId, messageId);
    }
    return ack(savedState ? '❤️ Gespeichert' : 'Entfernt');
}
