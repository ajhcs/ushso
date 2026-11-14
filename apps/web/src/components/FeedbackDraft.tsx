import { useState } from 'react'
import { FEEDBACK_OUTCOMES, feedbackPreview } from '../lib/feedback-draft'
import type { FeedbackDraft as Draft } from '../lib/feedback-draft'
const empty = (): Draft => ({schema_version:'ushso.feedback-draft.v1',outcome:'other',permission_to_reply:false})
export function FeedbackDraft() {
  const [open,setOpen]=useState(false)
  const [draft,setDraft]=useState<Draft>(empty)
  const [status,setStatus]=useState('')
  let preview='',error=''
  try {preview=feedbackPreview(draft)} catch(e) {error=e instanceof Error?e.message:'Invalid draft.'}
  const close=()=>{setOpen(false);setDraft(empty());setStatus('')}
  return <section aria-labelledby="feedback-draft-heading"><h2 id="feedback-draft-heading">Prepare local feedback</h2>
    <p>This optional draft stays in memory. Nothing is sent or saved automatically. Do not include protected health information, credentials, restricted data, or sensitive research details.</p>
    {!open ? <button onClick={()=>setOpen(true)}>Prepare a feedback draft</button> : <div>
      <label>Outcome <select value={draft.outcome} onChange={e=>{setDraft({...draft,outcome:e.target.value as Draft['outcome']});setStatus('')}}>{FEEDBACK_OUTCOMES.map(outcome=><option key={outcome} value={outcome}>{outcome.replaceAll('_',' ')}</option>)}</select></label>
      <label>Supporting source URL (optional, HTTP or HTTPS)<input type="url" maxLength={2048} value={draft.source_url??''} onChange={e=>{setDraft({...draft,source_url:e.target.value});setStatus('')}} /></label>
      <label>Feedback (optional, 2,000 characters)<textarea maxLength={2000} value={draft.text??''} onChange={e=>{setDraft({...draft,text:e.target.value});setStatus('')}} /></label>
      <label><input type="checkbox" checked={draft.permission_to_reply} onChange={e=>{setDraft({...draft,permission_to_reply:e.target.checked});setStatus('')}} />I request a reply if I later send this feedback</label>
      <h3>Preview</h3>{error?<p role="alert">{error}</p>:<pre className="source-snapshot">{preview}</pre>}
      <p>Review the preview for sensitive details before copying. Copying does not deliver feedback. You can paste it into your email client and use the existing contact address: info@ushso.org. USHSO cannot confirm delivery from this page.</p>
      <button disabled={!!error} onClick={async()=>{try{await navigator.clipboard.writeText(preview);setStatus('Draft copied locally. It has not been delivered.')}catch{setStatus('Clipboard unavailable. Select and copy the preview manually; nothing has been delivered.')}}}>Copy feedback draft</button>
      <button onClick={close}>Close and clear draft</button><p role="status">{status}</p>
    </div>}
  </section>
}
