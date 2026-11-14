import { useI18n } from '@/i18n'
import type { ManagerNavKey } from './managerNavModel'

/** Texts of the manager navigation, shared by the side panel, the phone bar and the page title. */
export function useManagerLabels(): Record<ManagerNavKey, string> {
  const { t } = useI18n()
  return {
    home: t.admin.manager.home,
    cleanings: t.admin.nav.cleanings,
    incidents: t.admin.nav.incidents,
    chessboard: t.admin.more.chessboard,
    apartments: t.admin.nav.apartments,
  }
}
