"""Explicitly bounded large-document windows; never removes the ordinary 64-page cap."""
import sys, json, resource, os, hashlib
resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
try:
    import pypdf
    if pypdf.__version__ != '6.18.0':
        raise ValueError('PDF_QUALIFIED_VERSION_REQUIRED')
    if len(sys.argv) != 4:
        raise ValueError('PDF_WINDOW_ARGUMENTS')
    file, start_text, count_text = sys.argv[1:]
    start, count = int(start_text), int(count_text)
    if start < 1 or count < 1 or count > 8:
        raise ValueError('PDF_WINDOW_BOUNDS')
    if os.stat(file).st_size > 64 * 1024 * 1024:
        raise ValueError('PDF_BYTES_LIMIT')
    with open(file, 'rb') as handle:
        digest = hashlib.file_digest(handle, 'sha256').hexdigest()
    reader = pypdf.PdfReader(file)
    total = len(reader.pages)
    if total > 2048 or start > total or start + count - 1 > total:
        raise ValueError('PDF_DOCUMENT_WINDOW_LIMIT')
    pages = []
    for index in range(start - 1, start - 1 + count):
        page = reader.pages[index]
        content = page.get_contents()
        if content is not None and len(content.get_data()) > 8 * 1024 * 1024:
            raise ValueError('PDF_PAGE_CONTENT_LIMIT')
        text = page.extract_text(extraction_mode='layout')
        if len(text.encode('utf-8')) > 1024 * 1024:
            raise ValueError('PDF_PAGE_TEXT_LIMIT')
        pages.append({'physical_page': index + 1, 'text': text})
    output = json.dumps({'status': 'captured_window', 'pypdf_version': pypdf.__version__,
                         'pdf_sha256': digest, 'total_pages': total, 'start_page': start,
                         'count': count, 'pages': pages})
    if len(output.encode('utf-8')) > 8 * 1024 * 1024:
        raise ValueError('PDF_WINDOW_OUTPUT_LIMIT')
    print(output)
except Exception as error:
    print(json.dumps({'status': 'unavailable', 'error': type(error).__name__ + ': ' + str(error)}))
    sys.exit(1)
