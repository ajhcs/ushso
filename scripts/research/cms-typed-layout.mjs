export function parseTypedLayout(document){
 if(document.status!=='captured'||document.mode!=='layout')throw Error('LAYOUT_UNAVAILABLE');
 const lines=document.text.split('\n'),header=lines.findIndex(l=>/^\s*Term Name\s+Variable Name\s+Description\s+Type\s+Length\s*$/.test(l));
 if(header<0)throw Error('LAYOUT_HEADER');
 const first=lines[header+1]??'',cells=first.trim().split(/ {2,}/);
 if(first.length>2048||cells.length!==5||!['CHAR','NUM'].includes(cells[3])||!/^\d+$/.test(cells[4]))throw Error('LAYOUT_FIRST_ROW');
 let cursor=0;const positions=cells.map(cell=>{const i=first.indexOf(cell,cursor);cursor=i+cell.length;return i});
 const nameStart=Math.max(0,positions[1]-2),descriptionStart=positions[2]-2,typeStart=positions[3]-2,lengthStart=positions[3]+cells[3].length+2;
 if(!(0<=nameStart&&nameStart<descriptionStart&&descriptionStart<typeStart&&typeStart<lengthStart))throw Error('LAYOUT_COLUMNS');
 const rows=[];let active;
 for(let i=header+1;i<lines.length;i++){
  const l=lines[i];if(!l.trim())continue;
  const label=l.slice(0,nameStart).trim(),name=l.slice(nameStart,descriptionStart).trim(),description=l.slice(descriptionStart,typeStart).trim(),type=l.slice(typeStart,lengthStart).trim(),length=l.slice(lengthStart).trim();
  if(['CHAR','NUM'].includes(type)&&/^\d+$/.test(length)&&name){if(!Number.isSafeInteger(Number(length))||Number(length)<1||Number(length)>1000000)throw Error('LAYOUT_LENGTH');active={name,label,description,publisher_type:type,publisher_length:Number(length),unit:null,allowed_values_state:'unresolved',page:1,start_line:i+1,end_line:i+1};rows.push(active);}
  else if(active&&!type&&!length){active.name=[active.name,name].filter(Boolean).join(' ');active.label=[active.label,label].filter(Boolean).join(' ');active.description=[active.description,description].filter(Boolean).join(' ');active.end_line=i+1;}
  else throw Error('LAYOUT_AMBIGUOUS_ROW:'+String(i+1));
 }
 if(!rows.length||new Set(rows.map(r=>r.name)).size!==rows.length)throw Error('LAYOUT_VARIABLE_IDENTITY');
 for(const row of rows){row.source_quote=lines.slice(row.start_line-1,row.end_line).join('\n');row.continuation_pending=row===rows.at(-1)&&document.total_pages>1;row.eligible_for_schema_promotion=false;}
 return {status:'partial',pages_parsed:[1],unparsed_pages:Array.from({length:Math.max(0,document.total_pages-1)},(_,i)=>i+2),columns:{nameStart,descriptionStart,typeStart,lengthStart},variables:rows,review_status:'pending_owner_review',publication_authorized:false};
}
