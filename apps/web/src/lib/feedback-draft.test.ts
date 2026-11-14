import { expect, it } from 'vitest'
import { feedbackDraft, feedbackMailto, feedbackPreview } from './feedback-draft'
const empty=()=>({schema_version:'ushso.feedback-draft.v1',outcome:'other',permission_to_reply:false})
it('preview includes only visible supplied fields and never adds question identity or timestamps',()=>{
 const preview=feedbackPreview(empty());expect(preview).toContain('Permission to reply: not granted');expect(preview).not.toMatch(/question|timestamp|browser|location/i)
 expect(()=>feedbackDraft({...empty(),question:'private'})).toThrow();expect(feedbackMailto(empty())).toBeNull()
 expect(feedbackDraft({...empty(),source_url:'http://example.org/source'}).source_url).toBe('http://example.org/source')
})
it('rejects invalid enums, control characters, unsafe URLs and boundary overflows',()=>{
 for(const bad of [{outcome:'received'},{text:'x'.repeat(2001)},{text:'header\r\ninjected'},{source_url:'javascript:alert(1)'},{source_url:'https://user:pass@example.org'},{source_url:'https://127.0.0.1/file'},{source_url:'https://example.org/'+ 'x'.repeat(2048)},{legacy_record_id:'unmapped'}])expect(()=>feedbackDraft({...empty(),...bad})).toThrow()
 expect(feedbackDraft({...empty(),text:'x'.repeat(2000)}).text).toHaveLength(2000)
})
it('treats markup as plain text and bounds optional encoded mailto without truncating',()=>{
 const text='<script>alert(1)</script>';expect(feedbackPreview({...empty(),text})).toContain(text)
 expect(feedbackMailto({...empty(),text:'x'.repeat(2000)},true)).toBeNull()
 expect(feedbackMailto({...empty(),text:'a & b'},true)).toContain('a%20%26%20b')
})
