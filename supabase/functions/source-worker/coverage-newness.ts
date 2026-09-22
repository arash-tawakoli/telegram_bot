// Coverage is deliverable only when the provider supplies a parseable publication time.
export function coverageTimestampProof(entry:any,nowMs=Date.now()) {
  for(const value of [entry?.publishedAt,entry?.publishDate,entry?.creationDate,entry?.createdAt,entry?.firstPublishedAt,entry?.listingDate]) {
    if(typeof value!=='string' ||
       !/^(?:\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))$/.test(value))continue;
    const published=Date.parse(value),age=nowMs-published;
    if(Number.isFinite(published) && age>=-5*60*1000 && age<=24*60*60*1000)
      return {method:'source_timestamp',source_published_at:new Date(published).toISOString()};
  }
  return null;
}
