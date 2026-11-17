// Berlin uses the four previously idle slots; each of the three MCP regions
// runs every five minutes, with at most one source per minute.
// Existing Hamburg, SH, and cooperative source cadences remain unchanged.
const SOURCE_ROTATION = Object.freeze([69, 1, 72, 3, 23, 69, 1, 29, 72, 35, 69, 1, 72, 3, 23, 69, 1, 29, 72, 66]);

export function sourcesForMinute(minute) {
  const source = SOURCE_ROTATION[minute % SOURCE_ROTATION.length];
  return source === null ? [] : [source];
}

export function scheduledTasksForMinute(minute) {
  return {
    verifyTelegramWebhook: minute % 5 === 0,
    engagement: minute % 60 === 15,
    telegramRecovery: minute % 5 === 0,
    platformSessionReminders: minute % 10 === 0,
    premiumOverrideExpiry: minute % 60 === 0,
  };
}
