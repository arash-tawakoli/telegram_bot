const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const reverse = new Map([...BASE64].map((c, i) => [c, i]));

function decompress(length, resetValue, getNextValue) {
  const dictionary = [0, 1, 2];
  let enlargeIn = 4, dictSize = 4, numBits = 3, entry = '', result = '';
  const data = { val: getNextValue(0), position: resetValue, index: 1 };
  const readBits = (bits) => {
    let value = 0, power = 1;
    const maxPower = 1 << bits;
    while (power !== maxPower) {
      const resb = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.val = getNextValue(data.index++);
      }
      if (resb > 0) value |= power;
      power <<= 1;
    }
    return value;
  };
  let next = readBits(2), c;
  if (next === 0) c = String.fromCharCode(readBits(8));
  else if (next === 1) c = String.fromCharCode(readBits(16));
  else if (next === 2) return '';
  else return null;
  dictionary[3] = c;
  let w = c;
  result = c;
  while (true) {
    if (data.index > length) return null;
    let code = readBits(numBits);
    if (code === 0) {
      dictionary[dictSize++] = String.fromCharCode(readBits(8));
      code = dictSize - 1;
      enlargeIn--;
    } else if (code === 1) {
      dictionary[dictSize++] = String.fromCharCode(readBits(16));
      code = dictSize - 1;
      enlargeIn--;
    } else if (code === 2) return result;
    if (enlargeIn === 0) {
      enlargeIn = 1 << numBits;
      numBits++;
    }
    if (dictionary[code] != null) entry = String(dictionary[code]);
    else if (code === dictSize) entry = w + w.charAt(0);
    else return null;
    result += entry;
    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;
    if (enlargeIn === 0) {
      enlargeIn = 1 << numBits;
      numBits++;
    }
  }
}

export function decompressBase64(input) {
  if (!input) return '';
  const clean = String(input).replace(/\s/g, '');
  return decompress(clean.length, 32, (index) => reverse.get(clean.charAt(index)) ?? 0);
}

function money(value) {
  if (value == null) return null;
  let text = String(value).replace(/\s/g, '').replace(/[^\d.,-]/g, '');
  if (!text) return null;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function exactWarm(prices) {
  if (!Array.isArray(prices)) return null;
  for (const price of prices) {
    const label = String(price?.label || '').replace(/\s+/g, ' ').trim();
    if (!/^(?:Warmmiete|Gesamtmiete|Bruttowarmmiete|Bruttomiete)$/i.test(label)) continue;
    if (price?.isEstimated === true) continue;
    const value = money(price?.ariaLabel ?? price?.value);
    if (value != null) return value;
  }
  return null;
}

function legacyId(value) {
  const direct = [value?.metadata?.legacyId, value?.tracking?.legacy_id, value?.legacyId, value?.legacy_id]
    .find((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x));
  if (direct) return direct.toLowerCase();
  const url = [value?.url, value?.canonicalUrl, value?.href].find((x) => typeof x === 'string');
  return url?.match(/\/expose\/([0-9a-f-]{36})(?:[/?#]|$)/i)?.[1]?.toLowerCase() || null;
}

export function structuredWarmRents(state) {
  const out = new Map();
  const visit = (value, depth = 0) => {
    if (!value || depth > 12) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    const warm = exactWarm(value?.hardFacts?.prices ?? value?.prices);
    const uuid = warm != null ? legacyId(value) : null;
    if (uuid && !out.has(uuid)) out.set(uuid, warm);
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(state);
  return out;
}

function fetcherData(html) {
  const script = String(html).match(/<script\b[^>]*\bid=["']__UFRN_FETCHER__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  const escaped = script?.match(/JSON\.parse\("((?:\\.|[^"\\])*)"\)/)?.[1];
  if (!escaped) return null;
  try {
    const jsonText = JSON.parse(`"${escaped}"`);
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

export function immoweltWarmRents(html) {
  const compressed = fetcherData(html)?.data?.['classified-serp-init-data'];
  if (typeof compressed !== 'string' || !compressed) return new Map();
  try {
    const plain = decompressBase64(compressed);
    return plain ? structuredWarmRents(JSON.parse(plain)) : new Map();
  } catch {
    return new Map();
  }
}

export function enrichImmoweltSerp(html, url) {
  let target;
  try { target = new URL(url); } catch { return html; }
  if (!/(^|\.)immowelt\.de$/i.test(target.hostname) || !target.pathname.startsWith('/suche/')) return html;
  const rents = immoweltWarmRents(html);
  if (!rents.size) return html;
  return String(html).replace(
    /(<a\b[^>]*href=["'][^"']*\/expose\/([0-9a-f-]{36})(?:[/?#][^"']*)?["'][^>]*>)/gi,
    (full, tag, uuid) => {
      const warm = rents.get(String(uuid).toLowerCase());
      return warm == null ? full : `${tag}<span hidden data-immowelt-exact-warm="1">Warmmiete ${warm} €</span>`;
    },
  );
}
