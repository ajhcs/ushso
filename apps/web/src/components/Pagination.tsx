import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  currentPage: number
  pageCount: number
  onChange: (page: number) => void
}

export function Pagination({ currentPage, pageCount, onChange }: PaginationProps) {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1)
  return (
    <nav className="pagination" aria-label="Search results pages">
      <button type="button" disabled={currentPage === 1} onClick={() => onChange(currentPage - 1)}>
        <ChevronLeft aria-hidden="true" /> Previous
      </button>
      <div className="pagination__pages">
        {pages.map((page) => (
          <button
            type="button"
            key={page}
            aria-current={page === currentPage ? 'page' : undefined}
            onClick={() => onChange(page)}
          >
            {page}
          </button>
        ))}
      </div>
      <button type="button" disabled={currentPage === pageCount} onClick={() => onChange(currentPage + 1)}>
        Next <ChevronRight aria-hidden="true" />
      </button>
    </nav>
  )
}
