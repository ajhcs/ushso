import { Route, Routes } from 'react-router-dom'
import { AgentsPage } from './pages/AgentsPage'
import { DatasetDetailsPage } from './pages/DatasetDetailsPage'
import { LandingPage } from './pages/LandingPage'
import { SearchResultsPage } from './pages/SearchResultsPage'
import { StandardPage } from './pages/StandardPage'

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/search" element={<SearchResultsPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/datasets/:datasetId" element={<DatasetDetailsPage />} />
        <Route path="/sources" element={<StandardPage title="Data sources" copy="The Observatory routes people to original authoritative sources and preserves each source’s content, coverage, limitations, and access requirements." />} />
        <Route path="/about" element={<StandardPage title="About the Observatory" copy="A free discovery and routing layer for the nation’s health systems data." />} />
        <Route path="/privacy" element={<StandardPage title="Privacy" copy="No account is required. USHSO does not intentionally persist search questions or personal information. Cloudflare may process connection metadata to serve the site. Do not submit personal health information." />} />
        <Route path="/terms" element={<StandardPage title="Terms" copy="Discovery metadata is provided as-is and does not replace validation at the authoritative source. Source-specific licenses, fees, applications, data-use agreements, and restrictions continue to apply." />} />
        <Route path="/contact" element={<StandardPage title="Contact" copy="For product feedback, open an issue in the public ajhcs/ushso GitHub repository. For a potential security issue, use the repository owner’s GitHub profile to request a private reporting route rather than posting details publicly." />} />
        <Route path="*" element={<StandardPage title="Page not found" copy="The requested Observatory page does not exist." />} />
      </Routes>
    </>
  )
}
