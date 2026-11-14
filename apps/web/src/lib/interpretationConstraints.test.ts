import {expect,it} from 'vitest'
import {constraintsRequest, interpretationSubjects, validateInterpretationConstraints} from './interpretationConstraints'
import {readSearchState,writeSearchState} from './searchParams'
it('validates controlled IDs and ordered observation years without changing question text',()=>{
 const value={subject:interpretationSubjects[0].id,geography:'US-PA',startYear:2010,endYear:2020}
 expect(constraintsRequest(value)).toEqual({subjects:[value.subject],geography:{codes:['US-PA']},time_window:{start_year:2010,end_year:2020}})
 expect(()=>validateInterpretationConstraints({...value,startYear:2021})).toThrow(/Start year/)
 expect(()=>validateInterpretationConstraints({...value,subject:'invented'})).toThrow(/Unknown subject/)
 expect(()=>validateInterpretationConstraints({...value,geography:'invented'})).toThrow(/Unknown geography/)
 expect(()=>validateInterpretationConstraints({...value,endYear:NaN})).toThrow(/integers/)
 const state=readSearchState(new URLSearchParams('q=Synthetic+question&sort=canonical_relevance&page=1'))
 const result=readSearchState(writeSearchState({...state,constraints:value,cursor:null,generation:null}))
 expect(result.q).toBe('Synthetic question');expect(result.constraints).toEqual(value);expect(result.cursor).toBeNull();expect(result.generation).toBeNull()
})
it('removes added constraints explicitly while preserving inferred question text',()=>{
 const state=readSearchState(new URLSearchParams('q=hospital+in+Pennsylvania&subject=quality&geo=US-PA&year_start=2020'))
 expect(writeSearchState({...state,constraints:{},page:1,cursor:null,generation:null}).toString()).not.toMatch(/subject=|geo=|year_start=/)
 expect(constraintsRequest({})).toEqual({})
})
it('round-trips true overrides and strict coverage without making empty selections inferred again',async()=>{
 const {controlsRequest}=await import('./interpretationConstraints')
 const state=readSearchState(new URLSearchParams('q=hospital+in+Pennsylvania+2020&controls=1&coverage=verified_only'))
 expect(controlsRequest(state.constraints)).toEqual({intent_override:{subjects:[],geographies:[],observation_years:null},coverage_mode:'verified_only'})
 expect(readSearchState(writeSearchState(state)).constraints).toEqual(state.constraints)
})
it('rejects one-sided override ranges rather than silently removing them',async()=>{
 const {controlsRequest}=await import('./interpretationConstraints')
 expect(()=>controlsRequest({override:true,startYear:2020})).toThrow(/both/)
 expect(()=>controlsRequest({override:true,endYear:2020})).toThrow(/both/)
})
