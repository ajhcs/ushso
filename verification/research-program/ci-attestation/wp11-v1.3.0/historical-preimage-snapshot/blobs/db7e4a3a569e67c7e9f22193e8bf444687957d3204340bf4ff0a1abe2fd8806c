import { Check, Clipboard, Download, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { createBoundedPlanJson } from '../lib/planExport'
import type { CanonicalResearchPlan } from '../types/researchPlan'

export function PlanJsonExport({ plan }: { plan: CanonicalResearchPlan }) {
  const [status, setStatus] = useState('')
  const exported = useMemo(() => {
    try {
      return { value: createBoundedPlanJson(plan), error: null }
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : 'Plan export is unavailable.' }
    }
  }, [plan])

  const copy = async () => {
    if (!exported.value) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.')
      await navigator.clipboard.writeText(exported.value.json)
      setStatus('Canonical plan JSON copied.')
    } catch {
      setStatus('Copy failed. Download the bounded JSON file instead.')
    }
  }

  const download = () => {
    if (!exported.value) return
    const url = URL.createObjectURL(new Blob([exported.value.json], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = exported.value.filename
    anchor.click()
    URL.revokeObjectURL(url)
    setStatus('Canonical plan JSON download prepared.')
  }
  const exportValue = exported.value

  return (
    <div className="plan-export">
      <p>Export includes only this already-compiled canonical plan. It does not include a raw research question, payload, or analytical result.</p>
      {exported.error || !exportValue ? (
        <p className="plan-export__error" role="alert"><TriangleAlert aria-hidden="true" />{exported.error}</p>
      ) : (
        <>
          <div className="plan-export__actions">
            <button type="button" onClick={copy}><Clipboard aria-hidden="true" />Copy plan JSON</button>
            <button type="button" onClick={download}><Download aria-hidden="true" />Download plan JSON</button>
          </div>
          <p className="plan-export__size">{exportValue.byteLength.toLocaleString()} bytes · application/json · bounded to 256 KiB</p>
        </>
      )}
      <p className="sr-only" role="status" aria-live="polite">{status && <><Check aria-hidden="true" />{status}</>}</p>
    </div>
  )
}
