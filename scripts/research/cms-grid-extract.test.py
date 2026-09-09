import unittest, tempfile, os, subprocess, json, sys
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject, DictionaryObject

class GeometryTests(unittest.TestCase):
    def extract(self, content):
        with tempfile.TemporaryDirectory(prefix='cms-grid-fixture-', dir=os.environ['TMPDIR']) as directory:
            writer=PdfWriter();page=writer.add_blank_page(width=612,height=792)
            font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
            page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
            stream=DecodedStreamObject();stream.set_data(content);page[NameObject('/Contents')]=writer._add_object(stream)
            path=Path(directory)/'fixture.pdf'
            with path.open('wb') as f: writer.write(f)
            result=subprocess.run([sys.executable,'-I',str(Path(__file__).with_name('cms-grid-extract.py')),str(path)],capture_output=True,text=True,timeout=25)
            return result.returncode,json.loads(result.stdout)
    def test_only_separately_filled_rectangles_qualify(self):
        code,result=self.extract(b'10 10 100 1 re n\n20 20 100 1 re W n\n30 30 100 1 re S\n40 40 100 1 re f\n50 50 100 1 re 51 50 2 1 re f*\n')
        self.assertEqual(code,0)
        self.assertEqual(result['pages'][0]['rectangles'],[[40.0,40.0,140.0,41.0]])
    def test_multiline_text_is_not_assigned_by_one_baseline(self):
        code,result=self.extract(b'BT /F1 12 Tf 10 700 Td (first variable) Tj 0 -30 Td (second variable) Tj ET')
        # pypdf may emit separate visitor spans (safe) or one multiline span
        # (must be rejected). It must never emit one accepted multiline span.
        if code:
            self.assertIn('PDF_MULTILINE_SPAN_AMBIGUOUS',result['error'])
        else:
            self.assertTrue(all('\n' not in s['text'] for s in result['pages'][0]['spans']))

if __name__=='__main__': unittest.main()
