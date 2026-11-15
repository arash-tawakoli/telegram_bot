// One shared polling interval for both ImmoScout24 regions (10 minutes).
// The existing source scheduler, queues, and matchers stay unchanged.
const SOURCE_ROTATION = Object.freeze([69, 1, null, 3, 23, null, 29, null, null, 35, 69, 1, null, 3, 23, null, 29, null, null, 66]);

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
