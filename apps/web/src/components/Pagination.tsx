import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  currentPage: number
  pageCount: number
  onChange: (page: number) => void
}

export function Pagination({ currentPage, pageCount, onChange }: PaginationProps) {
  return (
    <nav className="pagination" aria-label="Search results pages">
      <button type="button" aria-label="Go to previous results page" disabled={currentPage === 1} onClick={() => onChange(currentPage - 1)}>
        <ChevronLeft aria-hidden="true" /> Previous
      </button>
      <div className="pagination__pages" aria-live="polite">
        <span className="pagination__summary" aria-current="page">Page {currentPage} of {pageCount}</span>
      </div>
      <button type="button" aria-label="Go to next results page" disabled={currentPage === pageCount} onClick={() => onChange(currentPage + 1)}>
        Next <ChevronRight aria-hidden="true" />
      </button>
    </nav>
  )
}
