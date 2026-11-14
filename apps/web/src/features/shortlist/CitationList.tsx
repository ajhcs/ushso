import {safeExternalHttpsUrl} from '../../lib/externalUrls'
import type {SourceSnapshot} from './types'
export function CitationList({snapshot}:{snapshot:SourceSnapshot}) {
 const citations=snapshot.citations
 if(!citations?.length)return <p>Publisher citation metadata is unavailable in this snapshot. Evidence IDs alone do not provide a usable source citation.</p>
 return <section aria-label={`Publisher citations for ${snapshot.title}`}><h3>Publisher citations</h3><p>Captured metadata for this pinned snapshot. Capture dates do not confirm current rights, access or payload availability.</p><ul>{citations.map(citation=>{
  const href=safeExternalHttpsUrl(citation.canonical_url)
  return <li key={citation.capture_id}>
   <p>{href?<a href={href} target="_blank" rel="noreferrer noopener" referrerPolicy="no-referrer">{citation.canonical_url}</a>:<span>{citation.canonical_url} (preserved locator; not a verified navigation route)</span>}</p>
   <p>Metadata retrieved <time dateTime={citation.retrieved_at}>{citation.retrieved_at}</time>. Capture: {citation.capture_id}.</p>
   <p>Locator ({citation.locator_scheme}): {citation.locators.map(locator=>typeof locator==='string'?locator:`positions ${locator.start}–${locator.end}`).join('; ')}.</p>
   <p>Metadata capture SHA-256: {citation.content_sha256??'not recorded (metadata-only capture)'}. This does not verify a dataset payload.</p>
  </li>
 })}</ul></section>
}
