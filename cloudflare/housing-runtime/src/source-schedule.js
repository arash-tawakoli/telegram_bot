// Berlin uses the four previously idle slots; each of the three MCP regions
// runs every five minutes, with at most one source per minute.
// Existing Hamburg, SH, and cooperative source cadences remain unchanged.
const SOURCE_ROTATION = Object.freeze([69, 1, 72, 3, 23, 69, 1, 72, 29, 35, 69, 1, 72, 3, 23, 69, 1, 72, 29, 66]);

// Kleinanzeigen (2) runs in addition to the rotation every five minutes.
// It answers with only its ten newest ads per category, so it stays frequent.
export function sourcesForMinute(minute) {
  const source = SOURCE_ROTATION[minute % SOURCE_ROTATION.length];
  return [...(source === null ? [] : [source]), ...(minute % 5 === 2 ? [2] : [])];
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
