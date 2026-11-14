import vocabulary from '../../../../packages/retrieval/versions/v1.2.0/fixtures/controlled-vocabulary.json'
export interface InterpretationConstraints { subject?: string; geography?: string; startYear?: number; endYear?: number; override?: boolean; coverageMode?: 'all'|'verified_only'|'unresolved_only' }
export const interpretationSubjects = vocabulary.subjects.map(item=>({id:item.id,label:item.label}))
export const interpretationGeographies = vocabulary.geographies.map(item=>({id:item.code,label:item.label}))
export function validateInterpretationConstraints(value: InterpretationConstraints): InterpretationConstraints {
  if (value.subject && !interpretationSubjects.some(item=>item.id===value.subject)) throw new Error('Unknown subject constraint.')
  if (value.geography && !interpretationGeographies.some(item=>item.id===value.geography)) throw new Error('Unknown geography constraint.')
  for (const year of [value.startYear,value.endYear]) if (year !== undefined && (!Number.isInteger(year)||year<1800||year>2200)) throw new Error('Observation years must be integers from 1800 to 2200.')
  if(value.override && ((value.startYear===undefined)!==(value.endYear===undefined)))throw new Error('Supply both observation years, or leave both empty.')
  if (value.startYear !== undefined && value.endYear !== undefined && value.startYear>value.endYear) throw new Error('Start year must not exceed end year.')
  if(value.coverageMode&&!['all','verified_only','unresolved_only'].includes(value.coverageMode))throw new Error('Unknown coverage selection.')
  return value
}
export function constraintsRequest(value: InterpretationConstraints | undefined) {
  if (!value || value.override) return {}
  validateInterpretationConstraints(value)
  return {...(value.subject?{subjects:[value.subject]}:{}),...(value.geography?{geography:{codes:[value.geography]}}:{}),...(value.startYear!==undefined||value.endYear!==undefined?{time_window:{...(value.startYear!==undefined?{start_year:value.startYear}:{}),...(value.endYear!==undefined?{end_year:value.endYear}:{})}}:{})}
}

export function controlsRequest(value: InterpretationConstraints | undefined) {
 if(!value?.override)return undefined
 validateInterpretationConstraints(value)
 return {intent_override:{subjects:value.subject?[value.subject]:[],geographies:value.geography?[value.geography]:[],observation_years:value.startYear!==undefined&&value.endYear!==undefined?{start:value.startYear,end:value.endYear}:null},coverage_mode:value.coverageMode??'all'}
}
