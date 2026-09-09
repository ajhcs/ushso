import json, sys, resource
resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024))
resource.setrlimit(resource.RLIMIT_CPU,(15,15))
try:
    from pypdf import PdfReader, __version__
    if __version__ != '6.18.0': raise ValueError('PYPDF_QUALIFIED_VERSION_REQUIRED')
    if len(sys.argv)!=2: raise ValueError('PDF_ARGUMENT_REQUIRED')
    reader = PdfReader(sys.argv[1])
    if reader.is_encrypted: raise ValueError('PDF_ENCRYPTED')
    if len(reader.pages)>300: raise ValueError('PDF_PAGE_LIMIT')
    pages=[]
    size=0
    for i,page in enumerate(reader.pages):
        content=page.get_contents()
        if content is not None and len(content.get_data())>16*1024*1024: raise ValueError('PDF_CONTENT_LIMIT')
        text=page.extract_text() or ''
        size+=len(text.encode('utf-8'))
        if size>2*1024*1024: raise ValueError('PDF_TEXT_LIMIT')
        pages.append({'page':i+1,'text':text})
    print(json.dumps({'parser':'pypdf','version':__version__,'pages':pages}))
except Exception as error:
    print(json.dumps({'status':'unavailable','error':type(error).__name__+': '+str(error)}))
    sys.exit(1)
