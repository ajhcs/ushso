import {expect,it} from 'vitest'
import {fetchControlledDiscovery} from './controlledDiscoveryClient'
const query={question:'Synthetic corrected question'},controls={intent_override:{subjects:[],geographies:[],observation_years:null},coverage_mode:'all'}
it.each([[400,'cursor_query_mismatch','cursor_invalid'],[409,'cursor_query_mismatch','cursor_invalid'],[410,'generation_unavailable','generation_unavailable']])('preserves typed traversal restart for HTTP %i',async(status,code,expected)=>{
 const fetchImpl=async()=>new Response(JSON.stringify({error:{code}}),{status:Number(status)})
 await expect(fetchControlledDiscovery(query,controls,new AbortController().signal,fetchImpl as typeof fetch)).rejects.toMatchObject({code:expected})
})
it('does not publish a completed response after cancellation',async()=>{
 const controller=new AbortController();const fetchImpl=async()=>{controller.abort();return new Response(JSON.stringify({contract_version:'ushso.controlled-discovery.result.v1'}))}
 await expect(fetchControlledDiscovery(query,controls,controller.signal,fetchImpl as typeof fetch)).rejects.toMatchObject({code:'aborted'})
})
