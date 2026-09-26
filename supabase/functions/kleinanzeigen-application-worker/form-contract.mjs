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

export function providerFormCandidates(semantic, value, displayValue = null) {
  const kind = String(semantic || '').toLowerCase();
  if (kind === 'salutation') {
    const group = salutationGroup(value);
    if (!group) return value == null ? null : { [marker]: true, candidates: [value], fallback: displayValue ?? value };
    const candidates = [...new Set([...(SALUTATION_LABELS[group] || []), value, displayValue].filter(v => v != null && String(v).trim() !== ''))];
    return { [marker]: true, candidates, fallback: displayValue ?? SALUTATION_LABELS[group][0] };
  }
  if (kind === 'income') {
    const candidates = [...new Set([displayValue, value].filter(v => v != null && String(v).trim() !== ''))];
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

export function isProviderFormCandidates(value) {
  return !!value?.[marker];
}
