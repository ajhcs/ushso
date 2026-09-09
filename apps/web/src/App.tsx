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

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/search" element={<SearchResultsPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/datasets/:datasetId" element={<DatasetDetailsPage />} />
        <Route path="/sources" element={<SourcesPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/methods" element={<MethodsPage />} />
        <Route path="/privacy" element={<StandardPage title="Privacy" copy="No account is required. USHSO does not intentionally persist search questions or personal information. Cloudflare may process connection metadata to serve the site. Do not submit personal health information." />} />
        <Route path="/terms" element={<StandardPage title="Terms" copy="Discovery metadata is provided as-is and does not replace validation at the authoritative source. Source-specific licenses, fees, applications, data-use agreements, and restrictions continue to apply." />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="*" element={<StandardPage title="Page not found" copy="The requested Observatory page does not exist." />} />
      </Routes>
    </>
  )
}
