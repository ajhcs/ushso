import type {DiscoveryQuery,DiscoveryResult} from '../types/discovery'
import {assertDiscoveryResult,DiscoveryProviderError} from './discoveryProvider'
export interface ControlledOptions {intent_override:{subjects:string[];geographies:string[];observation_years:{start:number;end:number}|null};coverage_mode:string}
export interface CoverageFilter {mode:string;before_count:number;included_count:number;excluded_count:number;verified_count:number;unresolved_count:number;explanation:string}
export async function fetchControlledDiscovery(query:DiscoveryQuery,controls:ControlledOptions,signal:AbortSignal,fetchImpl:typeof fetch=fetch):Promise<{discovery:DiscoveryResult;coverage_filter:CoverageFilter}> {
 const response=await fetchImpl('/api/discovery-controls/v1/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contract_version:'ushso.controlled-discovery.input.v1',query,...controls}),signal})
 if(!response.ok){
  const body=await response.json().catch(()=>null)
  const code=String(body?.error?.code??body?.reason??'')
  if(response.status===410||code==='generation_unavailable')throw new DiscoveryProviderError('generation_unavailable','This controlled traversal belongs to an unavailable generation. Restart this search; your question and correction choices are preserved.')
  if(code.includes('cursor')||response.status===409)throw new DiscoveryProviderError('cursor_invalid','This continuation no longer matches the ranking or corrections. Restart this search; your question and correction choices are preserved.')
  throw new DiscoveryProviderError('http_error','Controlled discovery is unavailable. Your question and choices remain visible.')
 }
 const value=await response.json()
 if(signal.aborted)throw new DiscoveryProviderError('aborted','Controlled discovery was cancelled.')
 if(value.contract_version!=='ushso.controlled-discovery.result.v1')throw new DiscoveryProviderError('invalid_contract','Invalid controlled discovery response.')
 assertDiscoveryResult(value.discovery)
 const coverage=value.coverage_filter
 if(!coverage||coverage.mode!==controls.coverage_mode||!['before_count','included_count','excluded_count','verified_count','unresolved_count'].every(key=>Number.isSafeInteger(coverage[key])&&coverage[key]>=0)||coverage.included_count+coverage.excluded_count!==coverage.before_count||coverage.verified_count+coverage.unresolved_count!==coverage.before_count)throw new DiscoveryProviderError('invalid_contract','Invalid coverage counts.')
 return value
}
