const SOURCE_ROTATION = Object.freeze([69, 1, 71, 3, 23, 69, 29, 71, 34, 35, 69, 1, 71, 3, 23, 69, 29, 71, 34, 66]);
const SHADOW_SOURCES = Object.freeze([30, 32, 36, 39]);

export function sourcesForMinute(minute) {
  const sources = [SOURCE_ROTATION[minute % SOURCE_ROTATION.length]];
  if (minute % 5 === 0) sources.push(SHADOW_SOURCES[Math.floor(minute / 5) % SHADOW_SOURCES.length]);
  return sources;
}
