import { useEffect, useState } from 'react'
import type { AptType } from '@/lib/database.types'
import { Chessboard } from './Chessboard'
import { useAuth } from '@/modules/core/store'
import { fetchBonusRates, fetchCleaningCoefs } from './payrollApi'
import { premiumRatesFromBonus } from './payrollModel'

/** The chessboard of the admin and the manager: the premium row appears once the admin has set the premiums. */
export function ChessboardRoute({ apartmentPath }: { apartmentPath?: (id: number) => string }) {
  const isAdmin = useAuth((s) => s.profile?.role === 'admin')
  const [rates, setRates] = useState<Partial<Record<AptType, number>> | null>(null)
  const [coefs, setCoefs] = useState<ReadonlyMap<string, number>>(new Map())
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let alive = true
    fetchBonusRates()
      .then((r) => { if (alive) setRates(premiumRatesFromBonus(r)) })
      .catch(() => { if (alive) setRates(null) })
    return () => { alive = false }
  }, [])
  useEffect(() => {
    let alive = true
    fetchCleaningCoefs()
      .then((m) => { if (alive) setCoefs(m) })
      .catch(() => { if (alive) setCoefs(new Map()) })
    return () => { alive = false }
  }, [version])
  return <Chessboard premiumRates={rates} coefs={coefs} canEditCoef={isAdmin} onCoefsChanged={() => setVersion((v) => v + 1)} apartmentPath={apartmentPath} />
}
