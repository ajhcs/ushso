import { ArrowRight, BarChart3, Building2, Database, FileText, Search, UserRound } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { getSuggestions } from '../lib/uiSearch'

interface SearchBoxProps {
  initialQuery?: string
  onSubmit: (query: string) => void
}

const suggestionIcons = [Building2, BarChart3, FileText, UserRound, Database]

export function SearchBox({ initialQuery = '', onSubmit }: SearchBoxProps) {
  const [query, setQuery] = useState(initialQuery)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId().replaceAll(':', '')
  const suggestions = useMemo(() => getSuggestions(query), [query])

  useEffect(() => {
    setActiveIndex(-1)
  }, [query])

  const updateOpen = (nextOpen: boolean) => {
    setOpen(nextOpen)
  }

  const submit = (value = query) => {
    const normalized = value.trim()
    if (!normalized) {
      inputRef.current?.focus()
      return
    }
    updateOpen(false)
    onSubmit(normalized)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open && suggestions.length) updateOpen(true)
      setActiveIndex((index) => (index + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open && suggestions.length) updateOpen(true)
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1))
    } else if (event.key === 'Enter' && open && activeIndex >= 0) {
      event.preventDefault()
      const selection = suggestions[activeIndex]
      setQuery(selection)
      submit(selection)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      updateOpen(false)
      setActiveIndex(-1)
    }
  }

  return (
    <div className="hero-search">
      <form className="hero-search__form" role="search" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor={`${listId}-input`}>Describe the question you are trying to answer</label>
        <input
          ref={inputRef}
          id={`${listId}-input`}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            updateOpen(Boolean(event.target.value.trim()))
          }}
          onFocus={() => updateOpen(Boolean(query.trim()))}
          onBlur={() => window.setTimeout(() => updateOpen(false), 120)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${listId}-listbox`}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
          placeholder="Describe the question you’re trying to answer…"
          autoComplete="off"
        />
        <button type="submit" aria-label="Search the Observatory">
          <ArrowRight aria-hidden="true" />
        </button>
      </form>
      {open && suggestions.length > 0 && (
        <div className="search-suggestions">
          <ul id={`${listId}-listbox`} role="listbox" aria-label="Suggested searches">
            {suggestions.map((suggestion, index) => {
              const SuggestionIcon = suggestionIcons[index]
              return (
                <li
                  id={`${listId}-option-${index}`}
                  key={suggestion}
                  role="option"
                  aria-selected={activeIndex === index}
                  className={activeIndex === index ? 'search-suggestions__option search-suggestions__option--active' : 'search-suggestions__option'}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    setQuery(suggestion)
                    submit(suggestion)
                  }}
                >
                  <SuggestionIcon aria-hidden="true" />
                  <span>{suggestion}</span>
                </li>
              )
            })}
          </ul>
          <div className="search-suggestions__helper">
            <Search aria-hidden="true" />
            <span>We’ll help you find data sources, what they contain, and how to access them.</span>
          </div>
        </div>
      )}
    </div>
  )
}
