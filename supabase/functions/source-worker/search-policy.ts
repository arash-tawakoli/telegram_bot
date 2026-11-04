export const RETAINED_PORTAL_SOURCE_IDS = new Set([1,3,69,71]);
export const RETAINED_IMMOMIO_SOURCE_IDS = new Set([23,28,29,30,32,34,35,36,39,65,66]);
export const VERIFIED_TENANT_SOURCE_IDS = new Set([37]);

export function isImmomioSearchSource(sourceId:number){
  return RETAINED_IMMOMIO_SOURCE_IDS.has(Number(sourceId));
}

export function isAllowedSearchSource(sourceId:number){
  const id=Number(sourceId);
  return RETAINED_PORTAL_SOURCE_IDS.has(id)
    || RETAINED_IMMOMIO_SOURCE_IDS.has(id)
    || VERIFIED_TENANT_SOURCE_IDS.has(id);
}
