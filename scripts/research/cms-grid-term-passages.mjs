import {parseGrid} from './cms-grid-parser.mjs';
// This does not resolve a payload key. It preserves publisher terminology
// when an otherwise explicit bordered row has an empty Variable Name cell.
export function parseGridTermPassages(document){
 const parsed=parseGrid(document),term_passages=[];
 for(const issue of parsed.issues){
  if(issue.code!=='GRID_ROW_IDENTITY_OR_CONTINUATION'||!Array.isArray(issue.cells)||issue.cells.length!==3)continue;
  const [variable,term,definition]=issue.cells;
  if(variable!==''||typeof term!=='string'||!/^\w+$/.test(term)||typeof definition!=='string'||!definition)continue;
  term_passages.push({publisher_term:term,definition_passage:definition,page:issue.page,bounds:issue.bounds,source_cells:issue.cells,variable_name:null,variable_identity:'unresolved_empty_publisher_variable_cell',description_completeness:'unverified',unit:null,release_applicability:'unresolved',eligible_for_schema_promotion:false});
 }
 return {status:term_passages.length?'term_passages_pending_review':'unresolved',term_passages,variables:parsed.variables,issues:parsed.issues,scientific_approval:false,canonical_records_changed:0};
}
