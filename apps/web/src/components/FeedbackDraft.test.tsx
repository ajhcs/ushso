import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { FeedbackDraft } from './FeedbackDraft'
it('starts closed with explicit local-only boundaries and no submission endpoint',()=>{
 const markup=renderToStaticMarkup(createElement(FeedbackDraft));expect(markup).toContain('Prepare a feedback draft');expect(markup).toContain('Nothing is sent or saved automatically');expect(markup).not.toContain('mailto:');expect(markup).not.toContain('Submitted');expect(markup).not.toContain('<form')
})
