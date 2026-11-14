import json,pathlib
r=pathlib.Path(__file__).resolve().parents[2]; raw=json.loads((r/'docs/source-selection-evidence/publisher-observations.json').read_text()); obs={x['observation_id']:x for x in raw['observations']}; ledger=json.loads((r/'data/source-selection/candidate-ledger.json').read_text())
loc={'hcris':'Heading Hospital 2552-2010 form; first two paragraphs: hospital cost reports and hierarchy of as-submitted, final settled, reopened reports','phc4':'Heading Available Data introduction; Inpatient Discharge Data first paragraph; Standard Data paragraph','meps':'Introduction after Data and Statistics navigation','hcup':'Availability of HCUP Databases: State Inpatient Databases/Central Distributor column, Pennsylvania row; revised 11/10/26','owners':'JavaScript application shell; no substantive product documentation','general':'Direct request failure; no substantive direct capture','compendium':'Direct request returned empty 202; web reader: Compendium heading introduction and Data File table'}
captures=[]
for k in ('hcris','phc4','meps','hcup','owners','general','compendium'):
 o=obs[k]; o['locator']=loc[k]; o['capture_id']='capture_20261114_'+k
 captures.append(dict(capture_id=o['capture_id'],asset_id='asset_'+k,rights_id='rights_'+k,canonical_url=o['url'],retrieved_at=o['observed_at'],locator_scheme='publisher heading and paragraph',retention_mode='metadata_only',retention_reason='Ledger-compatible metadata capture only; separately retained private review artifacts in observation are pending formal rights determination and are not accepted byte captures'))
props=[]
def prop(id,k,p,v,locator):
 o=obs[k];props.append(dict(proposal_id=id,subject_id='asset_'+k,predicate=p,value=v,scope={},observed_at=o['observed_at'],evidence_refs=[dict(capture_id=o['capture_id'],locator=locator)],review_status='pending',decision=None))
prop('P01','hcris','purpose','Hospital cost report data','Hospital 2552-2010 form, first paragraph')
prop('P02','hcris','limitations',['Files contain the highest available cost report status for reported fiscal years; a specific record may be as submitted, settled, or reopened.'],'Hospital 2552-2010 form, second paragraph')
prop('P03','phc4','grain','Inpatient discharge record','Inpatient Discharge Data, first paragraph')
prop('P04','phc4','geography',{'level':'state','regions':['PA']},'Inpatient Discharge Data, first paragraph; facilities located in Pennsylvania, not patient residence')
prop('P05','phc4','limitations',['Regional files comprise records from facilities within the region, not necessarily patients residing there.'],'Standard Data, paragraph on statewide, regional, and facility records')
prop('P06','phc4','access_routes',[{'kind':'purchase_request_information','url':obs['phc4']['url']}],'Available Data, introduction; purchase route information only')
for k in ('hcris','phc4'):
 asset=next(a for a in ledger['assets'] if a['asset_id']=='asset_'+k)
 prop('IDENTITY-'+k,k,'identity',{f:asset[f] for f in ('asset_id','publisher_id','title')},'Hospital 2552-2010 form heading on CMS.gov' if k=='hcris' else 'Available Data > Inpatient Discharge Data; PHC4 publisher name in footer/privacy notice')
terms=[]
for asset,keys in [('hcris',['cms_policy_attempt','cms_privacy']),('owners',['cms_policy_attempt','cms_privacy']),('general',['cms_policy_attempt','cms_privacy']),('phc4',['phc4_privacy','phc4_request']),('phc4_finance',['phc4_privacy','phc4_request']),('meps',['meps_copyright']),('hcup',['hcup_access']),('compendium',['ahrq_disclaimer'])]:
 for key in keys:
  o=obs[key];terms.append(dict(asset_id='asset_'+asset,url=o['url'],checked_at=o['observed_at'],locator={'cms_privacy':'Privacy Policy, What information is collected; no content-reuse grant established','meps_copyright':'MEPS Copyright Notice, main paragraph; excludes previously copyrighted photographs/illustrations','phc4_privacy':'Information collected; Information Disclaimer; footer copyright','phc4_request':'Purchase Customized Data; access request information','hcup_access':'Getting Access to AHRQ HCUP Databases; Agreements links; state DUA'}.get(key,'Attempted official policy page; failed response'),receipt_sha256=o.get('receipt_sha256'),status=o['status'],rights_review_status='human_needed',actions={x:'unresolved' for x in ['metadata_capture','store_bytes','send_to_provider','redistribute_excerpt','publish_metadata']}))
# Private review spans remain supplemental: ledger evidence references keep human-readable locators.
import hashlib
needles={'P01':b'Hospital 2552-10 Cost Report Data files','P02':b'These data files contain the highest','P03':b'PHC4 collects approximately','P04':b'PHC4 collects approximately','P05':b'Pennsylvania statewide records','P06':b'The health care data PHC4 collects','IDENTITY-hcris':b'Hospital 2552-10 Cost Report Data files','IDENTITY-phc4':b'PHC4 collects approximately'}
for p in props:
 o=obs[p['subject_id'].removeprefix('asset_')]
 if o.get('body_retained'):
  b=pathlib.Path(o['private_body_path']).read_bytes(); n=needles[p['proposal_id']]; pos=b.find(n,170000 if p['subject_id']=='asset_hcris' else 28000); assert pos>=0
  start=b.rfind(b'<p',0,pos); end=b.find(b'</p>',pos)+4; assert 0<=start<pos<end
  p['private_review_evidence']={'private_path':o['private_body_path'],'sha256':o['receipt_sha256'],'locator':{'start':start,'end':end},'quote_hash':hashlib.sha256(b[start:end]).hexdigest(),'scope':'private human review only; not approved ledger byte evidence'}
out=dict(schema_version=1,authority='Supplemental research proposal; no human decisions, acceptance, public permissions or ledger mutation',captures=captures,observations=raw['observations'],terms_evidence=terms,proposals=props)
(r/'docs/source-selection-evidence/review-packet.json').write_text(json.dumps(out,indent=2)+'\n')
