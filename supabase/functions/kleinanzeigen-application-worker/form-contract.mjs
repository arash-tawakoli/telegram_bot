const marker = '__providerFormEnumCandidates';

function fold(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function salutationGroup(value) {
  const valueKey = fold(value).replace(/\s/g, '');
  if (['mr', 'herr', 'male', 'mannlich', 'masculine'].includes(valueKey)) return 'MR';
  if (['ms', 'mrs', 'frau', 'female', 'weiblich', 'feminine'].includes(valueKey)) return 'MS';
  if (['diverse', 'divers', 'nonbinary', 'nonbinaryperson'].includes(valueKey)) return 'DIVERSE';
  if (['neutral', 'notspecified', 'keineangabe', 'keineangaben', 'nosalutation', 'none'].includes(valueKey)) return 'NEUTRAL';
  if (['company', 'firma'].includes(valueKey)) return 'COMPANY';
  return null;
}

const SALUTATION_LABELS = {
  MR: ['Herr', 'MR', 'MALE', 'Male', 'männlich'],
  MS: ['Frau', 'MS', 'FEMALE', 'Female', 'weiblich'],
  DIVERSE: ['Divers', 'Diverse', 'DIVERS', 'DIVERSE'],
  NEUTRAL: ['Keine Angabe', 'NOT_SPECIFIED', 'NO_SALUTATION', 'NEUTRAL', 'Neutral'],
  COMPANY: ['Firma', 'COMPANY'],
};

const INCOME_PROVIDER_CODES = {
  UNDER_500: 'LESS_THAN_500_EUR',
  '500_1000': 'EUR_500_TO_1000',
  '1000_1500': 'EUR_1000_TO_1500',
  '1500_2000': 'EUR_1500_TO_2000',
  '2000_3000': 'EUR_2000_TO_3000',
  '3000_4000': 'EUR_3000_TO_4000',
  '4000_5000': 'EUR_4000_TO_5000',
  OVER_5000: 'MORE_THAN_5000_EUR',
};

export function providerFormCandidates(semantic, value, displayValue = null) {
  const kind = String(semantic || '').toLowerCase();
  if (kind === 'salutation') {
    const group = salutationGroup(value);
    if (!group) return value == null ? null : { [marker]: true, candidates: [value], fallback: displayValue ?? value };
    const candidates = [...new Set([...(SALUTATION_LABELS[group] || []), value, displayValue].filter(v => v != null && String(v).trim() !== ''))];
    return { [marker]: true, candidates, fallback: displayValue ?? SALUTATION_LABELS[group][0] };
  }
  if (kind === 'income') {
    const providerCode = INCOME_PROVIDER_CODES[String(value ?? '').trim().toUpperCase()];
    const candidates = [...new Set([providerCode, displayValue, value].filter(v => v != null && String(v).trim() !== ''))];
    return candidates.length ? { [marker]: true, candidates, fallback: displayValue ?? value } : null;
  }
  return value;
}

function incomeBand(value) {
  const normalized = String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/(\d{1,3})\.(?=\d{3}(?:\D|$))/g, '$1');
  const matches = normalized.match(/\d+(?:,\d+)?/g) || [];
  if (matches.length !== 2) return null;
  const band = matches.map(part => Number(part.replace(',', '.')));
  return band.every(Number.isFinite) && band[0] < band[1] ? band : null;
}

function choices(prop) {
  const enumValues = Array.isArray(prop?.enum) ? prop.enum : [];
  const oneOf = [
    ...(Array.isArray(prop?.oneOf) ? prop.oneOf : []),
    ...(Array.isArray(prop?.anyOf) ? prop.anyOf : []),
  ];
  const enumNames = prop?.enumNames || prop?.['x-enumNames'] || prop?.['x-enum-names'] || [];
  const enumOptions = prop?.enumOptions || prop?.options?.enumOptions || [];
  if (enumValues.length) {
    return enumValues.map((value, index) => {
      const labels = [enumNames[index], enumOptions[index]?.label, enumOptions[index]?.title];
      for (const option of oneOf) {
        const optionValue = option?.const ?? option?.value;
        if (optionValue != null && String(optionValue) === String(value)) {
          labels.push(option.title, option.description, option.label);
        }
      }
      return { value, labels: labels.filter(label => label != null) };
    });
  }
  if (oneOf.length) {
    return oneOf.map(option => ({
      value: option?.const ?? option?.value ?? option?.enum?.[0],
      labels: [option?.title, option?.description, option?.label].filter(label => label != null),
    })).filter(option => option.value != null);
  }
  if (enumOptions.length) {
    return enumOptions.map(option => ({
      value: option?.value ?? option?.const,
      labels: [option?.label, option?.title].filter(label => label != null),
    })).filter(option => option.value != null);
  }
  return [];
}

function sameBand(left, right) {
  const a = incomeBand(left), b = incomeBand(right);
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

function equivalent(candidate, option, labels, semantic) {
  const targetStrings = [option, ...labels].filter(value => value != null).map(value => String(value));
  const candidateKey = fold(candidate);
  if (targetStrings.some(value => fold(value) === candidateKey)) return true;
  if (semantic === 'salutation') {
    const group = salutationGroup(candidate);
    return !!group && targetStrings.some(value => salutationGroup(value) === group);
  }
  if (semantic === 'income') return targetStrings.some(value => sameBand(candidate, value));
  return false;
}

export function resolveProviderFormEnum(prop, raw, semantic = '') {
  const wrapped = !!raw?.[marker];
  const candidates = wrapped ? raw.candidates : Array.isArray(raw) ? raw : [raw];
  const fallback = wrapped ? raw.fallback : Array.isArray(raw) ? raw[0] : raw;
  const options = choices(prop);
  if (!options.length) return fallback;
  for (const candidate of candidates) {
    if (candidate == null || String(candidate).trim() === '') continue;
    const found = options.find(option => equivalent(candidate, option.value, option.labels, semantic));
    if (found) return found.value;
  }
  if (candidates.every(candidate => candidate == null || String(candidate).trim() === '')) {
    const unspecified = options.find(option => ['not specified', 'keine angabe', 'keine angaben'].includes(fold(option.value)) || option.labels.some(label => ['not specified', 'keine angabe', 'keine angaben'].includes(fold(label))));
    return unspecified?.value;
  }
  return undefined;
}

function clipOption(value) {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120);
}

function findControl(uiSchema, key) {
  let found = null;
  const suffix = `/properties/${String(key)}`;
  const walk = value => {
    if (!value || typeof value !== 'object' || found) return;
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (value.type === 'Control' && String(value.scope || '').endsWith(suffix)) {
      found = value;
      return;
    }
    for (const child of Object.values(value)) walk(child);
  };
  walk(uiSchema);
  return found;
}

export function summarizeFormOptions(prop, uiSchema, key) {
  const enumValues = Array.isArray(prop?.enum) ? prop.enum : [];
  const enumNames = prop?.enumNames || prop?.['x-enumNames'] || prop?.['x-enum-names'] || [];
  const oneOf = Array.isArray(prop?.oneOf) ? prop.oneOf : [];
  const anyOf = Array.isArray(prop?.anyOf) ? prop.anyOf : [];
  const control = findControl(uiSchema, key);
  const uiEnumOptions = control?.options?.enumOptions ?? control?.options?.choices ?? [];
  const option = (value, label = '') => ({ value: clipOption(value), label: clipOption(label) });
  const values = enumValues.slice(0, 32).map((value, index) => {
    const matched = [...oneOf, ...anyOf].find(item => String(item?.const ?? item?.value ?? '') === String(value));
    const ui = Array.isArray(uiEnumOptions) ? uiEnumOptions[index] : null;
    return option(value, enumNames[index] ?? matched?.title ?? matched?.label ?? ui?.label ?? ui?.title ?? '');
  });
  const alternatives = list => list.slice(0, 32).map(item => option(item?.const ?? item?.value ?? item?.enum?.[0], item?.title ?? item?.label ?? item?.description ?? ''));
  const uiOptions = Array.isArray(uiEnumOptions) ? uiEnumOptions.slice(0, 32).map(item => option(item?.value ?? item?.const, item?.label ?? item?.title ?? '')) : [];
  return {
    schemaKeys: Object.keys(prop || {}).slice(0, 24),
    enum: values,
    oneOf: alternatives(oneOf),
    anyOf: alternatives(anyOf),
    uiOptions,
    uiControlKeys: Object.keys(control || {}).slice(0, 24),
  };
}

export function isProviderFormCandidates(value) {
  return !!value?.[marker];
}
