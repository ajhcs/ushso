import unittest,tempfile,zipfile,subprocess,sys,json,os
from pathlib import Path
BASE=Path(__file__).parent
class Limits(unittest.TestCase):
 def run_zip(self, entries):
  with tempfile.TemporaryDirectory(prefix='cms-xlsx-') as d:
   p=Path(d)/'fixture.xlsx'
   with zipfile.ZipFile(p,'w',compression=zipfile.ZIP_DEFLATED) as z:
    for k,v in entries.items():z.writestr(k,v)
   r=subprocess.run([sys.executable,'-I',str(BASE/'cms-xlsx-cells.py'),str(p)],capture_output=True,text=True,timeout=15)
   self.assertNotEqual(r.returncode,0);result=json.loads(r.stdout);self.assertEqual(result['status'],'unavailable');return result['error']
 def test_entity_rejected(self):
  self.assertIn('XLSX_UNSAFE_XML',self.run_zip({'xl/sharedStrings.xml':'<!DOCTYPE x [<!ENTITY e "evil">]><x>&e;</x>'}))
 def test_utf16_entity_rejected(self):
  self.assertIn('XLSX_UNSAFE_XML',self.run_zip({'xl/sharedStrings.xml':'<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE x [<!ENTITY e "evil">]><x>&e;</x>'.encode('utf-16')}))
 def test_member_path_rejected(self):
  self.assertIn('XLSX_MEMBER_LIMIT',self.run_zip({'../outside':'x'}))
 def test_member_size_rejected(self):
  self.assertIn('XLSX_MEMBER_LIMIT',self.run_zip({'large':'x'*(9*1024*1024)}))
 def test_external_sheet_rejected(self):
  self.assertIn('XLSX_EXTERNAL_SHEET',self.run_zip({'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="x" Target="https://example.com" TargetMode="External"/></Relationships>','xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="a" r:id="x"/></sheets></workbook>'}))
if __name__=='__main__':unittest.main()
