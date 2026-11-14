#!/usr/bin/env python3
"""Capture the two explicitly authorized public pages for private human review.
No publication, provider sharing, dataset acquisition or formal rights decision.
"""
import datetime,hashlib,json,pathlib,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[2]
DEST=pathlib.Path('/workspace/build/builderbob/ushso-publication-ai/evidence/private-review')
TARGETS={'hcris':'https://www.cms.gov/data-research/statistics-trends-and-reports/cost-reports/hospital-2552-2010-form','phc4':'https://www.phc4.org/request-custom-data/available-data/','cms_privacy':'https://www.cms.gov/about-cms/web-policies-important-links/web-policies/privacy'}
if __name__=='__main__':
 DEST.mkdir(parents=True,exist_ok=True); manifest=[]
 for key,url in TARGETS.items():
  at=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'USHSo source review documentation observation'}),timeout=30) as r:
   body=r.read(2000001);assert len(body)<=2000000
   assert r.status==200
   stamp=at.replace(':','').replace('-','');path=DEST/(key+'-'+stamp+'.html');path.write_bytes(body)
   needles={'hcris':[b'Hospital 2552',b'highest level of cost report status'],'phc4':[b'Inpatient Discharge Data',b'Standard Data',b'Financial Data'],'cms_privacy':[b'Privacy Policy']}[key]
   locators=[{'needle_ascii':n.decode(),'byte_start':body.find(n),'byte_end_exclusive':body.find(n)+len(n)} for n in needles]
   assert all(x['byte_start']>=0 for x in locators)
   manifest.append(dict(observation_id=key,url=url,observed_at=at,http_status=r.status,final_url=r.url,content_type=r.headers.get('Content-Type'),response_bytes=len(body),receipt_sha256=hashlib.sha256(body).hexdigest(),status='substantive',retention_mode='private_review_bytes',body_retained=True,private_body_path=str(path),byte_locators=locators,retention_purpose='private human review, not publication or provider sharing',authorization_basis='Explicit user-authorized evidence preparation as scoped by parent task; ordinary bounded public page fetch; no publisher permission or formal ledger rights decision asserted',formal_rights_status='unresolved'))
 (DEST/'manifest.json').write_text(json.dumps({'schema_version':1,'observations':manifest},indent=2)+'\n')
 f=ROOT/'docs/source-selection-evidence/publisher-observations.json';original=json.loads(f.read_text());prior=ROOT/'docs/source-selection-evidence/initial-metadata-observations.json'
 if not prior.exists():prior.write_text(f.read_text())
 lookup={x['observation_id']:x for x in manifest};original['observations']=[lookup.get(x['observation_id'],x) for x in original['observations']]+[lookup['cms_privacy']]
 f.write_text(json.dumps(original,indent=2)+'\n')
 print(json.dumps(manifest,indent=2))
