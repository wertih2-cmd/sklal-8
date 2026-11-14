import { useLocation } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { titleKeyFor, type NavKey, type MoreKey } from './adminNavModel'

export function useNavLabels(): Record<NavKey, string> {
  const { t } = useI18n()
  const n = t.admin.nav
  return {
    home: n.home, stock: n.stock, move: n.move, apartments: n.apartments,
    orders: t.admin.more.orders, inventory: t.admin.more.inventory, documents: t.admin.more.documents, catalog: t.admin.more.catalog,
    incidents: n.incidents, cleanings: n.cleanings, chessboard: t.admin.more.chessboard, reports: n.reports, more: n.more,
  }
}

/** Title of the current section for the phone top bar (the app name when the path is unknown). */
export function usePageTitle(): string {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const labels = useNavLabels()
  const key = titleKeyFor(pathname)
  if (key == null) return t.app.name
  return key in labels ? labels[key as NavKey] : t.admin.more[key as MoreKey]
}
