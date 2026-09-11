import fs from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {adaptDiscoveryResponse} from './apps/web/src/lib/catalogAdapter.ts';
import {buildResearcherGuidance} from './apps/web/src/lib/researcherGuidance.ts';
import {freshnessPresentation} from './apps/web/src/pages/DatasetDetailsPage.tsx';
import {ResultCard} from './apps/web/src/components/ResultCard.tsx';
const responses=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const base=responses.dataset;
function present(response){const item=adaptDiscoveryResponse(response).records[0];return {grain:item.grain,typical_unit:buildResearcherGuidance(item).useCard.fields.find(x=>x.label==='Typical unit'),verification:item.verification,detail_freshness:freshnessPresentation(item),card:renderToStaticMarkup(createElement(MemoryRouter,{},createElement(ResultCard,{result:item})))}}
const grains={};for(const state of ['unresolved','source_asserted','verified_first_party','inferred','unavailable']){const r=structuredClone(base);r.results[0].metadata.dimensions.observation_grain={state,values:['hospital']};grains[state]=present(r);}
const failed=structuredClone(base);failed.results[0].metadata.freshness.last_successful_metadata_check=null;failed.results[0].metadata.freshness.latest_attempt={at:null,outcome:'failed',scope:'catalog_metadata'};
console.log(JSON.stringify({grains,explicit_null:present(failed),routes:Object.fromEntries(Object.entries(responses).map(([k,r])=>[k,present(r)]))}));