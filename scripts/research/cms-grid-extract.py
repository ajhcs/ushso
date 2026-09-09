"""Bounded public PDF geometry capture. No network and no scientific inference."""
import sys, json, math, resource
resource.setrlimit(resource.RLIMIT_AS, (512*1024*1024, 512*1024*1024))
resource.setrlimit(resource.RLIMIT_CPU, (20,20))
try:
    import pypdf
    if pypdf.__version__ != '6.18.0': raise ValueError('PYPDF_QUALIFIED_VERSION_REQUIRED')
    if len(sys.argv) != 2: raise ValueError('PDF_ARGUMENT_REQUIRED')
    reader = pypdf.PdfReader(sys.argv[1])
    if reader.is_encrypted: raise ValueError('PDF_ENCRYPTED')
    if len(reader.pages) > 64: raise ValueError('PDF_PAGE_LIMIT')
    pages = []
    total_text = 0
    for number, page in enumerate(reader.pages, 1):
        rectangles, spans, pending = [], [], []
        path_state = {'rectangular': True}
        def point(x,y,m):
            return [x*m[0]+y*m[2]+m[4], x*m[1]+y*m[3]+m[5]]
        def operand(op,args,cm,tm):
            if op in (b'm',b'l',b'c',b'v',b'y'):
                path_state['rectangular'] = False
            if op in (b'f',b'F',b'f*',b'B',b'B*',b'b',b'b*',b'S',b's',b'n'):
                # Only a separately filled rectangle qualifies. A clipping path,
                # unpainted path, stroke-only box or compound/hole path does not.
                if op in (b'f',b'F',b'f*',b'B',b'B*',b'b',b'b*') and path_state['rectangular'] and len(pending)==1:
                    rectangles.append(pending[0])
                pending.clear()
                path_state['rectangular'] = True
            if op != b're': return
            if abs(cm[1]) > .001 or abs(cm[2]) > .001: raise ValueError('PDF_ROTATED_GEOMETRY')
            x,y,w,h = map(float,args)
            a,b = point(x,y,cm),point(x+w,y+h,cm)
            pending.append([min(a[0],b[0]), min(a[1],b[1]),max(a[0],b[0]),max(a[1],b[1])])
            if len(rectangles)+len(pending)>50000: raise ValueError('PDF_GEOMETRY_LIMIT')
        def text(value,cm,tm,font,size):
            if not value.strip(): return
            if '\n' in value.strip() or '\r' in value.strip(): raise ValueError('PDF_MULTILINE_SPAN_AMBIGUOUS')
            if abs(cm[1])>.001 or abs(cm[2])>.001 or abs(tm[1])>.001 or abs(tm[2])>.001: raise ValueError('PDF_ROTATED_TEXT')
            x,y = point(tm[4],tm[5],cm)
            spans.append({'text':value.strip(),'x':x,'y':y})
            if len(spans)>50000: raise ValueError('PDF_SPAN_LIMIT')
        content = page.get_contents()
        if content is not None and len(content.get_data()) > 16*1024*1024: raise ValueError('PDF_CONTENT_LIMIT')
        if content is not None: page.extract_text(visitor_operand_before=operand,visitor_text=text)
        total_text += sum(len(s['text']) for s in spans)
        if total_text > 2*1024*1024: raise ValueError('PDF_TEXT_LIMIT')
        if not all(math.isfinite(v) for r in rectangles for v in r): raise ValueError('PDF_NONFINITE_GEOMETRY')
        pages.append({'page':number,'status':'captured' if spans else 'needs_ocr','rectangles':rectangles,'spans':spans})
    print(json.dumps({'parser':'pypdf','version':pypdf.__version__,'mode':'painted-bordered-grid-v2','total_pages':len(reader.pages),'pages':pages}))
except Exception as error:
    print(json.dumps({'status':'unavailable','error':type(error).__name__+': '+str(error)}))
    sys.exit(1)
