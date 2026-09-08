export function parseVariableLayout(document){
 if(document.status!=='captured'||document.mode!=='layout')throw Error('LAYOUT_UNAVAILABLE');
 const lines=document.text.split('\n'),header=lines.findIndex(l=>/^\s*Variable Name\s+Term Name\s+Definition\s*$/.test(l));
 if(header<0)throw Error('LAYOUT_HEADER');
 const first=lines[header+1]??'',cells=first.trim().split(/ {2,}/);
 if(first.length>2048||cells.length!==3)throw Error('LAYOUT_FIRST_ROW');
 let cursor=0;const positions=cells.map(cell=>{const i=first.indexOf(cell,cursor);cursor=i+cell.length;return i});
 const labelStart=Math.max(0,positions[1]-2),descriptionStart=positions[2]-2,rows=[];let active;
 if(!(0<labelStart&&labelStart<descriptionStart))throw Error('LAYOUT_COLUMNS');
 for(let i=header+1;i<lines.length;i++){
  const line=lines[i];if(!line.trim())continue;
  const name=line.slice(0,labelStart).trim(),label=line.slice(labelStart,descriptionStart).trim(),description=line.slice(descriptionStart).trim();
  if(name){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)||!label||!description)throw Error('LAYOUT_AMBIGUOUS_ROW:'+String(i+1));active={name,label,description,data_type:null,unit:null,allowed_values_state:'unresolved',page:1,start_line:i+1,end_line:i+1};rows.push(active);}
  else if(active){active.label=[active.label,label].filter(Boolean).join(' ');active.description=[active.description,description].filter(Boolean).join(' ');active.end_line=i+1;}
  else throw Error('LAYOUT_ORPHAN_CONTINUATION');
 }
 if(!rows.length||new Set(rows.map(r=>r.name)).size!==rows.length)throw Error('LAYOUT_VARIABLE_IDENTITY');
 for(const row of rows){row.source_quote=lines.slice(row.start_line-1,row.end_line).join('\n');row.continuation_pending=row===rows.at(-1)&&document.total_pages>1;row.eligible_for_schema_promotion=false;}
 return {status:'partial',pages_parsed:[1],unparsed_pages:Array.from({length:Math.max(0,document.total_pages-1)},(_,i)=>i+2),columns:{labelStart,descriptionStart},variables:rows,review_status:'pending_owner_review',publication_authorized:false};
}
