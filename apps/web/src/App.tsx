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
        <Route path="/privacy" element={<StandardPage title="Privacy" copy="The current frontend prototype does not require an account or collect personal information." />} />
        <Route path="/terms" element={<StandardPage title="Terms" copy="Source-specific licenses, fees, applications, and data use agreements continue to apply at the authoritative source." />} />
        <Route path="/contact" element={<StandardPage title="Contact" copy="A public contact channel will be added before production launch." />} />
        <Route path="*" element={<StandardPage title="Page not found" copy="The requested Observatory page does not exist." />} />
      </Routes>
    </>
  )
}
