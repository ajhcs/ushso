import unittest, tempfile, subprocess, sys, json, os
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject

class WindowLimits(unittest.TestCase):
    def setUp(self):
        scratch = os.environ.get('TMPDIR', '')
        self.assertTrue(scratch.startswith('/mnt/d/'))
        self.directory = tempfile.TemporaryDirectory(dir=scratch, prefix='pdf-window-test-')
        self.pdf = Path(self.directory.name) / 'public-fixture.pdf'
        writer = PdfWriter()
        page = writer.add_blank_page(width=100, height=100)
        content = DecodedStreamObject()
        content.set_data(b'BT ET')
        page[NameObject('/Contents')] = writer._add_object(content)
        writer.write(self.pdf)
    def tearDown(self):
        self.directory.cleanup()
    def invoke(self, start, count):
        result = subprocess.run([sys.executable, '-I', str(Path(__file__).with_name('pdf-text-window.py')),
                                 str(self.pdf), str(start), str(count)], capture_output=True, text=True, timeout=25)
        return result.returncode, json.loads(result.stdout)
    def test_exact_single_page_capture(self):
        code, output = self.invoke(1, 1)
        self.assertEqual(code, 0, output)
        self.assertEqual(output['count'], 1)
        self.assertEqual(output['total_pages'], 1)
    def test_zero_start_rejected(self):
        code, output = self.invoke(0, 1)
        self.assertNotEqual(code, 0)
        self.assertIn('PDF_WINDOW_BOUNDS', output['error'])
    def test_nine_page_window_rejected(self):
        code, output = self.invoke(1, 9)
        self.assertNotEqual(code, 0)
        self.assertIn('PDF_WINDOW_BOUNDS', output['error'])
    def test_window_past_end_rejected(self):
        code, output = self.invoke(1, 2)
        self.assertNotEqual(code, 0)
        self.assertIn('PDF_DOCUMENT_WINDOW_LIMIT', output['error'])

if __name__ == '__main__':
    unittest.main()
