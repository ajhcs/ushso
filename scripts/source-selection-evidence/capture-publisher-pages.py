#!/usr/bin/env python3
"""Bounded first-party documentation observations. No dataset downloads or crawler.
Run from repository root. Source bodies stay in memory unless the explicit text-only
MEPS policy below applies. Receipts are observations, never rights approvals.
"""
import argparse, datetime, hashlib, json, pathlib, urllib.request, urllib.error
from html.parser import HTMLParser
ROOT=pathlib.Path(__file__).resolve().parents[2]
PRIVATE=pathlib.Path('/workspace/build/builderbob/ushso-publication-ai/evidence')
class Text(HTMLParser):
 def __init__(self): super().__init__(); self.parts=[]; self.skip=0
 def handle_starttag(self,t,a):
  if t in ('script','style'): self.skip+=1
 def handle_endtag(self,t):
  if t in ('script','style'): self.skip=max(0,self.skip-1)
 def handle_data(self,d):
  if not self.skip and d.strip(): self.parts.append(' '.join(d.split()))
def observe(key,url,retain_text=False):
 at=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')
 result=dict(observation_id=key,url=url,observed_at=at,retention_mode='metadata_only',body_retained=False)
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'USHSo source review documentation observation'}),timeout=30) as r:
   body=r.read(2_000_001); result.update(http_status=r.status,final_url=r.url,content_type=r.headers.get('Content-Type'),response_bytes=len(body),receipt_sha256=hashlib.sha256(body).hexdigest())
  if len(body)>2_000_000: result['status']='blocked_size_limit'; return result
  p=Text(); p.feed(body.decode('utf-8','replace')); text='\n'.join(p.parts)
  result['status']='substantive' if len(text)>500 and 'You need to enable JavaScript' not in text else 'non_substantive'
  if retain_text and result['status']=='substantive':
   PRIVATE.mkdir(parents=True,exist_ok=True); target=PRIVATE/(key+'.txt'); target.write_text(text+'\n')
   result.update(retention_mode='text_only_private',body_retained=False,derived_text_retained=True,private_text_path=str(target),text_sha256=hashlib.sha256(target.read_bytes()).hexdigest(),retention_basis_url='https://meps.ahrq.gov/mepsweb/copyright.jsp',retention_rationale='Official MEPS copyright notice permits use of public-domain published text; photographs and illustrations excluded. HTML, scripts, images, and other binary assets are not retained. This is evidence preparation, not human approval of ledger rights.')
 except Exception as e:
  result.update(status='failed',error_type=type(e).__name__,error=str(e))
 return result
TARGETS=[
('hcris','https://www.cms.gov/data-research/statistics-trends-and-reports/cost-reports/hospital-2552-2010-form'),
('phc4','https://www.phc4.org/request-custom-data/available-data/'),
('phc4_privacy','https://www.phc4.org/privacy-policy/'),
('phc4_request','https://www.phc4.org/request-custom-data/'),
('meps','https://meps.ahrq.gov/mepsweb/'),
('meps_copyright','https://meps.ahrq.gov/mepsweb/copyright.jsp'),
('compendium','https://www.ahrq.gov/chsp/data-resources/compendium.html'),
('ahrq_disclaimer','https://www.ahrq.gov/policy/electronic/disclaimers/index.html'),
('hcup','https://hcup-us.ahrq.gov/db/availability_public.jsp'),
('hcup_access','https://hcup-us.ahrq.gov/tech_assist/centdist.jsp'),
('owners','https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/hospital-all-owners/api-docs'),
('general','https://data.cms.gov/provider-data/dataset/xubh-q36u'),
('cms_policy_attempt','https://www.cms.gov/about-cms/web-policies-important-links')]
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--retain-meps-text-reviewed',action='store_true',help='Explicitly confirm current MEPS text-only copyright basis was reviewed; never applies to other publishers')
 args=parser.parse_args()
 rows=[observe(k,u,args.retain_meps_text_reviewed and k in ('meps','meps_copyright')) for k,u in TARGETS]
 out=ROOT/'docs/source-selection-evidence/publisher-observations.json';out.write_text(json.dumps({'schema_version':1,'authority':'research observations only; no acceptance or rights decision','observations':rows},indent=2)+'\n')
 for r in rows: print(r['observation_id'],r['status'],r.get('http_status'),r.get('receipt_sha256'))
