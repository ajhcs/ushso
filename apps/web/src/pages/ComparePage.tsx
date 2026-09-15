import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { PageTitle } from '../components/PageTitle'
import {
  HCRIS_HOSPITAL_COST_REPORT_ID,
  HOSPITAL_MRF_EXAMPLE_ID,
  HUMAN_COMPARISON_DIMENSIONS,
  PAYER_MRF_EXAMPLE_ID,
  PHC4_PUBLIC_FINANCIAL_REPORTS_ID,
  PRICE_TYPE_LABELS,
  compareHumanSources,
  documentedSourceTitle,
  whyPairMayNotJoin,
  type ComparisonSource,
} from '../lib/humanComparison'
import { loadShortlist } from '../lib/shortlist'

const PRESETS: Record<string, ComparisonSource[]> = {
  hcris_phc4: [
    { record_id: HCRIS_HOSPITAL_COST_REPORT_ID, title: documentedSourceTitle(HCRIS_HOSPITAL_COST_REPORT_ID) },
    { record_id: PHC4_PUBLIC_FINANCIAL_REPORTS_ID, title: documentedSourceTitle(PHC4_PUBLIC_FINANCIAL_REPORTS_ID) },
  ],
  hospital_payer_mrf: [
    { record_id: HOSPITAL_MRF_EXAMPLE_ID, title: documentedSourceTitle(HOSPITAL_MRF_EXAMPLE_ID) },
    { record_id: PAYER_MRF_EXAMPLE_ID, title: documentedSourceTitle(PAYER_MRF_EXAMPLE_ID) },
  ],
}

function selectedSources(ids: string[]): ComparisonSource[] {
  const unique = [...new Set(ids)].slice(0, 5)
  const shortlist = loadShortlist().items
  return unique.map((recordId) => {
    const saved = shortlist.find((item) => item.record_id === recordId)
    return { record_id: recordId, title: saved?.title ?? documentedSourceTitle(recordId) }
  })
}

export function ComparePage() {
  const [params] = useSearchParams()
  const preset = params.get('preset')
  const queryIds = params.getAll('id')
  const sources = useMemo(() => {
    if (preset && PRESETS[preset]) return PRESETS[preset]
    if (queryIds.length >= 2) return selectedSources(queryIds)
    return PRESETS.hcris_phc4
  }, [preset, queryIds.join('|')])
  const comparison = compareHumanSources(sources)
  const pairNote = sources.length >= 2 ? whyPairMayNotJoin(sources[0].record_id, sources[1].record_id) : ''
  return (
    <div className="standard-page compare-page">
      <PageTitle label="Compare sources" />
      <ObservatoryHeader compact />
      <main id="main-content" className="standard-page__main">
        <p className="section-eyebrow">Human comparison</p>
        <h1>Compare documented metadata, not source values</h1>
        <p>This page uses the same evidence as <code>compare_assets</code>. Unknown and not-comparable dimensions stay explicit. No numeric overall quality score is assigned. This comparison does not compile a research plan.</p>
        <nav className="compare-presets" aria-label="Example comparisons">
          <Link to="/compare?preset=hcris_phc4">HCRIS and PHC4 financial reporting</Link>
          <Link to="/compare?preset=hospital_payer_mrf">Hospital and payer machine-readable files</Link>
        </nav>
        <p className="compare-pair" role="note">{pairNote}</p>
        <div className="compare-table-wrap">
          <table className="compare-table">
            <caption>Documented comparison dimensions for {sources.length} sources</caption>
            <thead>
              <tr>
                <th scope="col">Dimension</th>
                {sources.map((source) => <th scope="col" key={source.record_id}>{source.title}</th>)}
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {HUMAN_COMPARISON_DIMENSIONS.map((dimension) => {
                const row = comparison.dimensions.find((item) => item.dimension === dimension)!
                return (
                  <tr key={dimension} data-comparison-state={row.state}>
                    <th scope="row">{dimension.replaceAll('_', ' ')}</th>
                    {row.values.map((value) => <td key={value.asset_id}>{value.metadata_value ?? 'Unknown'}</td>)}
                    <td>{row.state}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="compare-explanation">{comparison.dimensions.find((row) => row.dimension === 'grain')?.explanation}</p>
        <section className="compare-price-types" aria-labelledby="price-types-heading">
          <h2 id="price-types-heading">Price types are not patient bills</h2>
          <dl>
            {Object.entries(PRICE_TYPE_LABELS).map(([key, label]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{label}</dd></div>)}
          </dl>
        </section>
        <ul className="compare-caveats">
          {comparison.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
        </ul>
        <p>Envelope construction is not comparison completeness. HTTP 200 is not a completed research task.</p>
        <Link className="button-link" to="/workspace">Return to local shortlist</Link>
      </main>
      <ObservatoryFooter />
    </div>
  )
}
