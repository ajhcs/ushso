import sys,json,zipfile,resource,posixpath,re,xml.etree.ElementTree as ET
resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024));resource.setrlimit(resource.RLIMIT_CPU,(10,10))
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
def xml(z,name):
    data=z.read(name)
    if len(data)>8*1024*1024 or b'\x00' in data:raise ValueError('XLSX_UNSAFE_XML')
    text=data.decode('utf-8-sig',errors='strict')
    declared=re.search(r'<\?xml\b[^?]*\bencoding\s*=\s*[\"\x27]([^\"\x27]+)',text,re.I)
    if declared and declared.group(1).lower() not in ('utf-8','utf8','us-ascii'):raise ValueError('XLSX_UNSUPPORTED_XML_ENCODING')
    if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():raise ValueError('XLSX_UNSAFE_XML')
    return ET.fromstring(text)
try:
    if len(sys.argv)!=2:raise ValueError('XLSX_ARGUMENT')
    with zipfile.ZipFile(sys.argv[1]) as z:
        entries=z.infolist()
        if len(entries)>200 or len({e.filename for e in entries})!=len(entries) or sum(e.file_size for e in entries)>16*1024*1024:raise ValueError('XLSX_ZIP_LIMIT')
        if any(e.file_size>8*1024*1024 or e.file_size>max(e.compress_size,1)*2000 or e.flag_bits&1 or e.filename.startswith('/') or '..' in e.filename.split('/') for e in entries):raise ValueError('XLSX_MEMBER_LIMIT')
        shared=[]
        if 'xl/sharedStrings.xml' in z.namelist():shared=[''.join(t.text or '' for t in n.findall('.//s:t',NS)) for n in xml(z,'xl/sharedStrings.xml').findall('s:si',NS)]
        rels={r.attrib['Id']:r.attrib for r in xml(z,'xl/_rels/workbook.xml.rels')}
        sheets=[];count=0
        for sheet in xml(z,'xl/workbook.xml').findall('s:sheets/s:sheet',NS):
            rel=rels[sheet.attrib['{'+NS['r']+'}id']]
            if rel.get('TargetMode')=='External':raise ValueError('XLSX_EXTERNAL_SHEET')
            target=posixpath.normpath(posixpath.join('xl',rel['Target']))
            if not target.startswith('xl/'):raise ValueError('XLSX_SHEET_PATH')
            root=xml(z,target);rows=[]
            for row in root.findall('s:sheetData/s:row',NS):
                cells=[]
                for cell in row.findall('s:c',NS):
                    count+=1
                    if count>100000:raise ValueError('XLSX_CELL_LIMIT')
                    value=cell.findtext('s:v',default='',namespaces=NS);kind=cell.attrib.get('t','n')
                    if kind=='s':
                        if not value.isdigit() or int(value)>=len(shared):raise ValueError('XLSX_SHARED_STRING_INDEX')
                        value=shared[int(value)]
                    elif kind=='inlineStr':value=''.join(t.text or '' for t in cell.findall('.//s:t',NS))
                    formula=cell.findtext('s:f',default=None,namespaces=NS)
                    if value or formula is not None:cells.append({'reference':cell.attrib['r'],'text':value,'type':kind,'formula':formula})
                if any(c['text'] for c in cells):rows.append({'row':int(row.attrib['r']),'cells':cells})
            sheets.append({'name':sheet.attrib['name'],'path':target,'rows':rows,'merged_cells':[m.attrib['ref'] for m in root.findall('s:mergeCells/s:mergeCell',NS)]})
        result=json.dumps({'status':'captured_cells','parser':'stdlib_zip_xml_cells_v1','sheets':sheets})
        if len(result)>8*1024*1024:raise ValueError('XLSX_OUTPUT_LIMIT')
        print(result)
except Exception as error:
    print(json.dumps({'status':'unavailable','error':type(error).__name__+': '+str(error)}));sys.exit(1)
