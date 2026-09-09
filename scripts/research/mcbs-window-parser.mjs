export function parseMcbsPages(pages) {
  if (!Array.isArray(pages)) throw Error('MCBS_PAGES');
  const variables = [], issues = []; let block = null;
  function finish() {
    if (!block) return;
    const label = block.lines.find(l => /^\s*SAS Label\s*:/.test(l.text));
    const match = label?.text.match(/^\s*SAS Label\s*:\s*(.*?)\s{3,}Variable Type\s*:\s*(.*?)\s*$/);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(block.name) || !match || !match[1]) {
      issues.push({code:'MCBS_IDENTITY_OR_LABEL_UNRESOLVED', name:block.name, source_lines:block.lines});
    } else variables.push({name:block.name, label:match[1], publisher_type_literal:match[2], description:null,
      unit:null, description_completeness:'publisher_label_only', source_lines:block.lines,
      ownership_evidence:'explicit_SAS_variable_heading_to_next_heading', release_applicability:'unresolved', eligible_for_schema_promotion:false});
    block = null;
  }
  for (const [i,page] of pages.entries()) {
    if (page?.physical_page !== i + 1 || typeof page.text !== 'string') throw Error('MCBS_PAGE_SEQUENCE');
    for (const [line,text] of page.text.split('\n').entries()) {
      const colon = text.indexOf(':');
      const start = colon >= 0 && text.slice(0,colon).replace(/\s/g,'') === 'SASVariable'
        ? [text,text.slice(colon+1).trim()] : null;
      if (start) { finish(); block = {name:start[1],lines:[]}; }
      if (block) block.lines.push({physical_page:page.physical_page,line:line+1,text});
    }
  }
  finish(); const counts = new Map();
  for (const v of variables) counts.set(v.name,(counts.get(v.name)??0)+1);
  const duplicates = [...counts].filter(([,n])=>n>1).map(([name])=>name);
  if (duplicates.length) issues.push({code:'MCBS_DUPLICATE_IDENTITY',names:duplicates});
  return {status:'partial_extracted_pending_review',variables:variables.filter(v=>!duplicates.includes(v.name)),issues,scientific_approval:false};
}
