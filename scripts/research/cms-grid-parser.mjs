// Only explicit publisher cell borders establish variable/definition ownership.
const grammars=[['Variable Name','Term Name','Definition'],['Term Name','Variable Name','Description','Type','Length']];
const unique=values=>[...new Set(values.map(v=>Math.round(v*10)/10))].sort((a,b)=>a-b);
export function parseGrid(document){
 if(document.mode!=='painted-bordered-grid-v2'||!Array.isArray(document.pages)||document.pages.length!==document.total_pages||document.pages.length>64)throw Error('GRID_DOCUMENT');
 const variables=[],issues=[],parsed=[];
 for(const [pageIndex,page] of document.pages.entries()){
  try{
   if(!page||page.page!==pageIndex+1)throw Error('GRID_PAGE_IDENTITY');
   if(page.status!=='captured'||!Array.isArray(page.rectangles)||!Array.isArray(page.spans))throw Error('GRID_PAGE_UNAVAILABLE');
   const {rectangles,spans}=page;
   if(rectangles.length>50000||spans.length>50000||rectangles.some(r=>r.length!==4||r.some(v=>!Number.isFinite(v)))||spans.some(s=>typeof s.text!=='string'||!Number.isFinite(s.x)||!Number.isFinite(s.y)))throw Error('GRID_GEOMETRY');
   if(spans.some(s=>/[\r\n]/.test(s.text.trim())))throw Error('GRID_MULTILINE_SPAN_AMBIGUOUS');
   const grammar=grammars.find(g=>g.every(label=>spans.some(s=>s.text===label)));
   if(!grammar)throw Error('GRID_HEADER_UNSUPPORTED');
   const candidates=spans.filter(s=>s.text===grammar[0]).map(first=>grammar.map(label=>spans.filter(s=>s.text===label&&Math.abs(s.y-first.y)<=2))).filter(group=>group.every(g=>g.length===1));
   if(candidates.length!==1)throw Error('GRID_HEADER_AMBIGUOUS');
   const hs=candidates[0].map(h=>h[0]),hy=hs[0].y;
   const vertical=rectangles.filter(([x,y,x2,y2])=>x2-x>0&&x2-x<=2&&y2-y>5&&y<=hy&&y2>=hy);
   const edges=unique(vertical.map(r=>r[2]));
   const bounds=[];
   for(const h of hs){const left=edges.filter(x=>x<h.x).at(-1),right=edges.find(x=>x>h.x);if(left===undefined||right===undefined)throw Error('GRID_COLUMN_BORDER_MISSING');bounds.push([left,right]);}
   if(bounds.some((b,i)=>i>0&&Math.abs(bounds[i-1][1]-b[0])>.2))throw Error('GRID_COLUMN_AMBIGUOUS');
   const x0=bounds[0][0],x1=bounds.at(-1)[1];
   const horizontal=rectangles.filter(([x,y,x2,y2])=>y2-y>0&&y2-y<=2&&x<=x0+2&&x2>=x1-2);
   const ys=unique(horizontal.map(r=>r[3])).sort((a,b)=>b-a);
   const headerBottom=ys.find(y=>y<hy);
   if(headerBottom===undefined)throw Error('GRID_ROW_BORDER_MISSING');
   const rowYs=ys.filter(y=>y<=headerBottom);
   if(rowYs.length<2)throw Error('GRID_ROWS_MISSING');
   let rows=0;
   for(let i=0;i<rowYs.length-1;i++){
    const top=rowYs[i],bottom=rowYs[i+1];
    const cellSpans=bounds.map(([left,right])=>spans.filter(s=>s.x>=left-.2&&s.x<right-.2&&s.y<top&&s.y>bottom).sort((a,b)=>b.y-a.y||a.x-b.x));
    const cells=cellSpans.map(a=>a.map(s=>s.text).join(' ').trim());
    if(cells.every(c=>!c))continue;
    const ni=grammar.indexOf('Variable Name'),li=grammar.indexOf('Term Name'),di=grammar.includes('Definition')?2:2;
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cells[ni])||!cells[li]||!cells[di]){issues.push({page:page.page,code:'GRID_ROW_IDENTITY_OR_CONTINUATION',bounds:[x0,bottom,x1,top],cells});continue;}
    if(grammar.length===5&&(!['CHAR','NUM'].includes(cells[3])||!/^\d+$/.test(cells[4])||+cells[4]<1||+cells[4]>1000000)){issues.push({page:page.page,code:'GRID_ROW_TYPE',bounds:[x0,bottom,x1,top],cells});continue;}
    variables.push({name:cells[ni],label:cells[li],description:cells[di],description_completeness:'unverified',unit:null,...(grammar.length===5?{publisher_type:cells[3],publisher_length:+cells[4]}:{}),page:page.page,bounds:[x0,bottom,x1,top],source_cells:cellSpans,ownership_evidence:'publisher_explicit_cell_borders',release_applicability:'unresolved',eligible_for_schema_promotion:false});rows++;
   }
   parsed.push({page:page.page,rows});
  }catch(error){issues.push({page:page?.page??pageIndex+1,code:error.message});}
 }
 const counts=new Map();for(const v of variables)counts.set(v.name,(counts.get(v.name)??0)+1);
 const duplicates=[...counts].filter(([,n])=>n>1).map(([name])=>name);
 if(duplicates.length)issues.push({code:'GRID_DUPLICATE_VARIABLE_IDENTITY',names:duplicates});
 return {status:issues.length?'partial':'extracted_pending_review',variables:variables.filter(v=>!duplicates.includes(v.name)),pages_parsed:parsed,issues,scientific_approval:false,publication_authorized:false,canonical_records_changed:0};
}
