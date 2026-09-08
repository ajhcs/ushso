export function parseQiesPages(pages) {
  if (!Array.isArray(pages)) throw Error('QIES_PAGES');
  const proposed = [], issues = []; let block = null, category = null;
  function finish() {
    if (!block) return;
    const names = block.lines.filter(l=>/^\s*SAS Name:\s*/.test(l.text));
    const descriptions = block.lines.map((l,i)=>/^\s*Description:\s*/.test(l.text)?i:-1).filter(i=>i>=0);
    const name = names[0]?.text.replace(/^\s*SAS Name:\s*/,'').trim();
    const end = names.length===1 ? block.lines.indexOf(names[0]) : -1;
    if (!block.category || names.length!==1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name??'')
      || descriptions.length!==1 || end<=descriptions[0] || block.end-block.start+1!==block.length) {
      issues.push({code:'QIES_FIELD_CONTEXT_OR_IDENTITY_UNRESOLVED',...block});
    } else proposed.push({name,label:block.label,category_code:block.category.code,category_label:block.category.label,
      publisher_length:block.length,publisher_start:block.start,publisher_end:block.end,
      description_passage:block.lines.slice(descriptions[0],end),description:null,
      description_completeness:'literal_passage_not_normalized',source_lines:block.lines,unit:null,
      ownership_evidence:'explicit_positional_field_header_and_SAS_Name_within_same_category',
      release_applicability:'unresolved',eligible_for_schema_promotion:false});
    block = null;
  }
  for (const [i,page] of pages.entries()) {
    if (page?.physical_page!==i+1 || typeof page.text!=='string') throw Error('QIES_PAGE_SEQUENCE');
    for (const [line,text] of page.text.split('\n').entries()) {
      const context=text.match(/^\s*(.+?), CATEGORY = "([0-9]+)"/);
      if(context){if(category?.code!==context[2])finish();category={code:context[2],label:context[1]};}
      const start=text.match(/^\s{3}(.+?)\s{2,}(\d+)\s+(\d+)\s+(\d+)(?:\s+(?:VARCHAR2|NUMBER|DATE))?\s*$/);
      if(start){finish();block={label:start[1].trim(),length:+start[2],start:+start[3],end:+start[4],category,lines:[]};}
      if(block)block.lines.push({physical_page:page.physical_page,line:line+1,text});
    }
  }
  finish();const counts=new Map();for(const v of proposed){const key=v.category_code+'\0'+v.name;counts.set(key,(counts.get(key)??0)+1);}
  const duplicates=[...counts].filter(([,n])=>n>1).map(([key])=>key);if(duplicates.length)issues.push({code:'QIES_DUPLICATE_CONTEXT_IDENTITY',identities:duplicates});
  return {status:'context_scoped_partial_proposals',variables:proposed.filter(v=>!duplicates.includes(v.category_code+'\0'+v.name)),issues,
    ordinary_dictionary_flattening_authorized:false,scientific_approval:false};
}
