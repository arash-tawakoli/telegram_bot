export function berlinClock(nowMs=Date.now()) {
  const parts=Object.fromEntries(
    new Intl.DateTimeFormat('en-CA',{
      timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hourCycle:'h23'
    }).formatToParts(new Date(nowMs))
      .filter((x:any)=>x.type!=='literal')
      .map((x:any)=>[x.type,Number(x.value)])
  );
  return {
    year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),
    hour:Number(parts.hour),minute:Number(parts.minute)
  };
}

export function sourceLabelAgeMinutes(value:any,nowMs=Date.now()) {
  const label=String(value??'').trim();
  const clock=berlinClock(nowMs);
  const tm=label.match(/(\d{1,2}):(\d{2})/);
  if(!tm)return null;
  const advertised=Number(tm[1])*60+Number(tm[2]);
  let dayDiff:number;
  if(/^Heute\b/i.test(label))dayDiff=0;
  else if(/^Gestern\b/i.test(label))dayDiff=1;
  else {
    const d=label.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if(!d)return null;
    dayDiff=Math.round(
      (Date.UTC(clock.year,clock.month-1,clock.day)-Date.UTC(Number(d[3]),Number(d[2])-1,Number(d[1])))/86400000
    );
  }
  return dayDiff*1440+clock.hour*60+clock.minute-advertised;
}

export function berlinDateDiff(value:any,nowMs=Date.now()) {
  const text=String(value??'').trim(),clock=berlinClock(nowMs);
  let y:number,m:number,d:number;
  let match=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(match){y=Number(match[1]);m=Number(match[2]);d=Number(match[3]);}
  else {
    match=text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if(!match)return null;
    d=Number(match[1]);m=Number(match[2]);y=Number(match[3]);
  }
  const t=Date.UTC(y,m-1,d);
  if(!Number.isFinite(t))return null;
  return Math.round((Date.UTC(clock.year,clock.month-1,clock.day)-t)/86400000);
}

export function publicationFresh(value:any,nowMs=Date.now()) {
  const text=String(value??'').trim();
  if(!text)return {ok:true,known:false};
  const relativeAge=sourceLabelAgeMinutes(text,nowMs);
  if(relativeAge!=null)return {ok:relativeAge>=-5&&relativeAge<=1440,known:true};
  const dateDiff=berlinDateDiff(text,nowMs);
  if(dateDiff!=null)return {ok:dateDiff===0,known:true};
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)){
    const ts=Date.parse(text),age=nowMs-ts;
    return {ok:Number.isFinite(ts)&&age>=-5*60*1000&&age<=24*60*60*1000,known:true};
  }
  return {ok:false,known:true};
}

export function deliveryNewness(l:any,eventType:any,publishedText:any=null,nowMs=Date.now()) {
  if(String(eventType||'new_listing')!=='new_listing')return {ok:true,reason:'change_event'};
  const seen=Date.parse(String(l.first_seen_at||'')),age=nowMs-seen;
  if(!Number.isFinite(seen)||age< -5*60*1000||age>24*60*60*1000)
    return {ok:false,reason:'first_seen_outside_24h'};
  if(!l.sources?.baseline_completed_at)
    return {ok:false,reason:'baseline_not_initialized'};
  if(Number(l.source_id)===1){
    const lane=String(l.raw?.delivery_lane||'');
    const proof=l.raw?._newness;
    const published=Date.parse(String(proof?.source_published_at||''));
    const proven=lane==='coverage_proven' && proof?.method==='source_timestamp' &&
      Number.isFinite(published) && nowMs-published>=-5*60*1000 && nowMs-published<=24*60*60*1000;
    const observed=Date.parse(String(proof?.observed_at||''));
    const mapDelta=lane==='map_delta' && proof?.method==='map_snapshot_delta' &&
      Number.isFinite(observed) && nowMs-observed>=-5*60*1000 && nowMs-observed<=24*60*60*1000;
    if(l.fresh_delivery_eligible!==true||(!['fresh_global','fresh_borough'].includes(lane)&&!proven&&!mapDelta))
      return {ok:false,reason:'immoscout_coverage_or_unverified'};
  } else if(l.fresh_delivery_eligible!==true) {
    return {ok:false,reason:'source_worker_newness_unverified'};
  }
  if(String(publishedText??'').trim()){
    const proof=publicationFresh(publishedText,nowMs);
    if(!proof.ok)return {ok:false,reason:'source_publication_not_provably_within_24h'};
  }
  return {ok:true,reason:'qualified'};
}
