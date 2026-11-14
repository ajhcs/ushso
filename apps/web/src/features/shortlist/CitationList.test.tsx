import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {expect,it} from 'vitest'
import {CitationList} from './CitationList'
import type {SourceSnapshot} from './types'
it('shows standalone publisher metadata dates and honest null hashes without making HTTP navigation claims',()=>{
 const snapshot:SourceSnapshot={schema_version:'ushso.source-selection.v1',asset_id:'synthetic:a',publisher_id:'synthetic:p',generation_id:'a'.repeat(64),title:'Synthetic source',assertion_ids:[],evidence_ids:['synthetic:e'],citations:[{capture_id:'synthetic:e',canonical_url:'http://example.org/source',retrieved_at:'2026-11-13T00:00:00Z',content_sha256:null,locator_scheme:'section',locators:['Metadata']}]}
 const markup=renderToStaticMarkup(createElement(CitationList,{snapshot}));expect(markup).toContain('http://example.org/source');expect(markup).toContain('2026-11-13T00:00:00Z');expect(markup).toContain('not recorded (metadata-only capture)');expect(markup).not.toContain('href="http://')
 snapshot.citations![0].canonical_url='https://example.org/source';expect(renderToStaticMarkup(createElement(CitationList,{snapshot}))).toContain('href="https://example.org/source"')
})
