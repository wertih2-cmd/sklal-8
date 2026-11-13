import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Modal } from '@/components/Modal'
import { ErrorState } from '@/components/ErrorState'
import { OwnerBadge } from '@/components/OwnerBadge'
import type { Apartment, AptType } from '@/lib/database.types'
import { fetchApartmentsAdmin } from './api'
import { filterApartments } from './apartmentSearch'

/** Quick jump to an apartment by its code (Ctrl+K, or the search button). Enter opens the highlighted row. */
export function AptSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const typeLabels: Record<AptType, string> = {
    studio: t.apartments.typeStudio,
    '1br': t.apartments.type1br,
    '2br': t.apartments.type2br,
  }

  // The list is fetched on every opening, so a new apartment is found at once; the old list shows meanwhile.
  const load = () => {
    setLoading(true)
    setFailed(false)
    fetchApartmentsAdmin()
      .then(setApartments)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    load()
    // The dialog focuses its own panel after this effect: take the focus back for the field.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  const results = useMemo(() => filterApartments(apartments, query), [apartments, query])

  const go = (a: Apartment) => {
    onClose()
    navigate(`/admin/apartments/${a.id}`)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, Math.max(results.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && results[cursor]) {
      e.preventDefault()
      go(results[cursor])
    }
  }

  return (
    <Modal open={open} title={t.admin.nav.search} onClose={onClose} glass hideHeader>
      <div className="well rounded-xl flex items-center gap-2.5 px-3 min-h-[48px]">
        <Search className="w-5 h-5 text-muted flex-none" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0) }}
          onKeyDown={onKeyDown}
          placeholder={t.apartments.search}
          aria-label={t.admin.nav.search}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 min-w-0 bg-transparent text-[15px] text-ink placeholder:text-muted outline-none py-3"
          data-testid="apt-search-input"
        />
      </div>

      <div className="mt-3 min-h-[120px]">
        {failed && apartments.length === 0 ? (
          <ErrorState onRetry={load} />
        ) : loading && apartments.length === 0 ? (
          <p className="text-center text-muted text-sm py-8">{t.app.loading}</p>
        ) : results.length === 0 ? (
          <p className="text-center text-muted text-sm py-8">{t.common.noResults}</p>
        ) : (
          <ul className="flex flex-col gap-1" role="listbox" aria-label={t.admin.nav.search}>
            {results.map((a, i) => (
              <li key={a.id} role="option" aria-selected={i === cursor}>
                <button
                  type="button"
                  onClick={() => go(a)}
                  onMouseEnter={() => setCursor(i)}
                  className={`w-full min-h-[48px] rounded-xl px-3 py-2 flex items-center gap-2.5 text-start transition-colors ${
                    i === cursor ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-[var(--line)]'
                  }`}
                >
                  <b className="text-[15px] font-semibold">{a.code}</b>
                  {a.is_owner && <OwnerBadge />}
                  <span className="ms-auto text-sm text-muted">{typeLabels[a.type]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
