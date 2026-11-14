import { useEffect, useState } from 'react'
import type { AptType } from '@/lib/database.types'
import { Chessboard } from './Chessboard'
import { fetchBonusRates } from './payrollApi'
import { premiumRatesFromBonus } from './payrollModel'

/** The chessboard of the admin and the manager: the premium row appears once the admin has set the premiums. */
export function ChessboardRoute({ apartmentPath }: { apartmentPath?: (id: number) => string }) {
  const [rates, setRates] = useState<Partial<Record<AptType, number>> | null>(null)
  useEffect(() => {
    let alive = true
    fetchBonusRates()
      .then((r) => { if (alive) setRates(premiumRatesFromBonus(r)) })
      .catch(() => { if (alive) setRates(null) })
    return () => { alive = false }
  }, [])
  return <Chessboard premiumRates={rates} apartmentPath={apartmentPath} />
}
