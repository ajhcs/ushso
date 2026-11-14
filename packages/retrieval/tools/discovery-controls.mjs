import { compileDiscoveryIntent } from './intent-compiler-v1.2.mjs';
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
export function controlledIntent(query, override, vocabulary, namedSources) {
  const intent=compileDiscoveryIntent(query,vocabulary,namedSources);
  if (override === undefined) return intent;
  if (!override || typeof override!=='object'||Array.isArray(override)||Object.keys(override).some(key=>!['subjects','geographies','observation_years'].includes(key))) throw new TypeError('Invalid intent override.');
  const suppressedTokens=new Set();
  const suppress=matches=>matches.flatMap(item=>item.matched_aliases??[]).forEach(alias=>String(alias).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).forEach(token=>suppressedTokens.add(token)));
  if(own(override,'subjects'))suppress(intent.interpretation.subjects);
  if(own(override,'geographies'))suppress(intent.interpretation.geographies);
  if(own(override,'observation_years'))for(const token of intent.normalized_question.match(/\b(?:18|19|20|21|22)\d{2}\b/g)??[])suppressedTokens.add(token);
  const ids=(value,entries,key)=>{if(!Array.isArray(value)||value.length>100||new Set(value).size!==value.length||value.some(id=>typeof id!=='string'||!entries.some(entry=>entry[key]===id)))throw new TypeError(`Unknown or duplicate ${key} override.`);return value};
  if(own(override,'subjects')) {
    const subjects=ids(override.subjects,vocabulary.subjects,'id');
    const explicit=compileDiscoveryIntent({question:'Find sources',subjects},vocabulary,namedSources);
    intent.interpretation.subjects=explicit.interpretation.subjects;
    intent.interpretation.units_of_analysis=intent.interpretation.units_of_analysis.filter(unit=>!(unit.matched_aliases??[]).some(alias=>alias.startsWith('implied_by:')));
    for(const unit of explicit.interpretation.units_of_analysis)if(!intent.interpretation.units_of_analysis.some(item=>item.id===unit.id))intent.interpretation.units_of_analysis.push(unit);
    intent.filters.subjects=subjects;
  }
  if(own(override,'geographies')) {
    const geographies=ids(override.geographies,vocabulary.geographies,'code');
    intent.interpretation.geographies=compileDiscoveryIntent({question:'Find sources',geography:{codes:geographies}},vocabulary,namedSources).interpretation.geographies;
    intent.filters.geography={codes:geographies,levels:[]};
  }
  if(own(override,'observation_years')) {
    const years=override.observation_years;
    if(years!==null&&(!years||typeof years!=='object'||Array.isArray(years)||Object.keys(years).some(key=>!['start','end'].includes(key))||!Number.isInteger(years.start)||!Number.isInteger(years.end)||years.start<1800||years.end>2200||years.start>years.end))throw new TypeError('Invalid observation-year override.');
    intent.interpretation.time_window=years===null?null:{start_year:years.start,end_year:years.end,match_basis:'explicit_override'};
    intent.filters.time_window=years===null?null:{start_year:years.start,end_year:years.end};
  }
  intent.interpretation.positive_terms=(intent.interpretation.positive_terms??[]).filter(token=>!suppressedTokens.has(token));
  intent.scoring_question=intent.normalized_question.split(' ').filter(token=>!suppressedTokens.has(token)).join(' ');
  intent.intent_override_applied=true;
  return intent;
}
function validPeriod(value) {
  if(typeof value!=='string')return false;
  if(/^\d{4}$/.test(value))return Number(value)>=1800&&Number(value)<=2200;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===value;
}
function scopedEvidence(record,ids,dimension,value) {
  return ids.every(id=>(record.evidence??[]).some(row=>row.evidence_id===id&&row.state==='verified_first_party'
    &&row.scope?.subject_record_id===record.record_id&&row.scope?.dimension===dimension
    &&JSON.stringify(row.scope.value)===JSON.stringify(value)));
}
export function coverageVerified(record, interpretation) {
  const geography=record.geography;
  if(geography?.evidence_state!=='verified_first_party'||!Array.isArray(geography.evidence_ids)||!geography.evidence_ids.length||!Array.isArray(geography.jurisdictions)||!geography.jurisdictions.length||!['national','multi_state','state','county','facility','mixed'].includes(geography.coverage_level))return false;
  if(!scopedEvidence(record,geography.evidence_ids,'geography',{coverage_level:geography.coverage_level,jurisdictions:geography.jurisdictions}))return false;
  if(interpretation.geographies.some(item=>!geography.jurisdictions.includes(item.id)))return false;
  if(interpretation.time_window) {
    const time=record.time_coverage;
    if(time?.evidence_state!=='verified_first_party'||!time.evidence_ids?.length||!validPeriod(time.start)||!validPeriod(time.end)
      ||!scopedEvidence(record,time.evidence_ids,'observation_period',{start:time.start,end:time.end}))return false;
    const start=Date.parse(`${time.start.length===4?`${time.start}-01-01`:time.start}T00:00:00Z`);
    const end=Date.parse(`${time.end.length===4?`${time.end}-12-31`:time.end}T00:00:00Z`);
    if(start>end||start>Date.UTC(interpretation.time_window.start_year,0,1)||end<Date.UTC(interpretation.time_window.end_year,11,31))return false;
  }
  return true;
}
