const SOURCE_ROTATION = Object.freeze([69, 1, null, 3, 23, 69, 29, null, 34, 35, 69, 1, null, 3, 23, 69, 29, null, 34, 66]);

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
