import sys,json,resource
resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024))
resource.setrlimit(resource.RLIMIT_CPU,(15,15))
try:
    import pypdf
    if pypdf.__version__ != '6.18.0': raise ValueError('PYPDF_QUALIFIED_VERSION_REQUIRED')
    if len(sys.argv)!=2: raise ValueError('PDF_ARGUMENT_REQUIRED')
    reader=pypdf.PdfReader(sys.argv[1])
    if reader.is_encrypted: raise ValueError('PDF_ENCRYPTED')
    page=reader.pages[0]
    content=page.get_contents()
    if content is not None and len(content.get_data())>16*1024*1024: raise ValueError('PDF_CONTENT_LIMIT')
    text=(page.extract_text(extraction_mode='layout',layout_mode_space_vertically=False) or '') if content is not None else ''
    if len(text)>2*1024*1024: raise ValueError('PDF_TEXT_LIMIT')
    print(json.dumps({'parser':'pypdf','version':pypdf.__version__,'mode':'layout','page':1,'total_pages':len(reader.pages),'text':text,'status':'captured' if text.strip() else 'needs_ocr'}))
except Exception as error:
    print(json.dumps({'status':'unavailable','error':type(error).__name__+': '+str(error)}))
    sys.exit(1)
