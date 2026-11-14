import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AgentsPage } from './pages/AgentsPage'
import { AboutPage } from './pages/AboutPage'
import { ContactPage } from './pages/ContactPage'
import { DatasetDetailsPage } from './pages/DatasetDetailsPage'
import { LandingPage } from './pages/LandingPage'
import { PlanPage } from './pages/PlanPage'
import { MethodsPage } from './pages/MethodsPage'
import { SearchResultsPage } from './pages/SearchResultsPage'
import { SourcesPage } from './pages/SourcesPage'
import { StandardPage } from './pages/StandardPage'

const ShortlistPage = lazy(() => import('./pages/ShortlistPage').then(module => ({default: module.ShortlistPage})))
const ComparePage = lazy(() => import('./pages/ComparePage').then(module => ({default: module.ComparePage})))

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/search" element={<SearchResultsPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/shortlist" element={<Suspense fallback={<p role="status">Loading shortlist…</p>}><ShortlistPage /></Suspense>} />
        <Route path="/compare" element={<Suspense fallback={<p role="status">Loading comparison…</p>}><ComparePage /></Suspense>} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/datasets/:datasetId" element={<DatasetDetailsPage />} />
        <Route path="/methods/archive/national-readiness" element={<SourcesPage archive />} />
        <Route path="/sources" element={<SourcesPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/methods" element={<MethodsPage />} />
        <Route path="/privacy" element={<StandardPage title="Privacy" copy="No account is required. Shortlists and feedback drafts start in browser memory. Saving a shortlist on this device requires an explicit action and lasts 30 days; expired entries are deleted on next opening, or when you choose Clear. If device storage removal fails, the page reports that it could not confirm deletion; clear saved site data in your browser settings. Saving a question requires separate consent. Notes and snapshots are included when you save; including a question in a JSON or Print export requires a separate choice for each export. Imported or restored snapshots remain unverified until checked against a retained rights-valid publication. Comparison sends source IDs, requested dimensions and a publication pin, never your question or notes. Feedback drafts are copy-only, stay in memory and clear when closed or reloaded; copying does not deliver feedback. Existing email and GitHub contact routes use their respective services. Cloudflare may process connection metadata to serve the site. Do not submit protected health information or credentials." />} />
        <Route path="/terms" element={<StandardPage title="Terms" copy="Discovery metadata is provided as-is and does not replace validation at the authoritative source. Source-specific licenses, fees, applications, data-use agreements, and restrictions continue to apply." />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="*" element={<StandardPage title="Page not found" copy="The requested Observatory page does not exist." />} />
      </Routes>
    </>
  )
}
