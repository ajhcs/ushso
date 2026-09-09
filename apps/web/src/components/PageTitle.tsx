import { useEffect } from 'react'
import { documentTitle, setDocumentTitle } from '../lib/documentTitle'

export function PageTitle({ label }: { label: string }) {
  useEffect(() => setDocumentTitle(documentTitle(label)), [label])
  return null
}
