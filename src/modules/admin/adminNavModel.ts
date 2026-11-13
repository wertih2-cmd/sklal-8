export type NavKey =
  | 'home' | 'stock' | 'move' | 'apartments'
  | 'orders' | 'inventory' | 'documents' | 'catalog'
  | 'incidents' | 'cleanings' | 'reports' | 'more'
export type NavGroup = 'work' | 'warehouse' | 'control'
export type BadgeKey = 'incidents' | 'cleanings'

export interface NavItem {
  key: NavKey
  to: string
  /** Match the path exactly (otherwise also everything below it). */
  end?: boolean
  group: NavGroup
  badge?: BadgeKey
}

export interface NavCounts {
  incidents: number | null
  cleanings: number | null
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', to: '/admin', end: true, group: 'work' },
  { key: 'move', to: '/admin/move', end: true, group: 'work' },
  { key: 'apartments', to: '/admin/apartments', group: 'work' },
  { key: 'stock', to: '/admin/stock', group: 'work' },
  { key: 'orders', to: '/admin/more/orders', group: 'warehouse' },
  { key: 'inventory', to: '/admin/more/inventory', group: 'warehouse' },
  { key: 'documents', to: '/admin/more/documents', group: 'warehouse' },
  { key: 'catalog', to: '/admin/more/catalog', group: 'warehouse' },
  { key: 'incidents', to: '/admin/more/incidents', group: 'control', badge: 'incidents' },
  { key: 'cleanings', to: '/admin/more/cleaning-approvals', group: 'control', badge: 'cleanings' },
  { key: 'reports', to: '/admin/more/reports', group: 'control' },
  { key: 'more', to: '/admin/more', group: 'control' },
]

/** Bottom bar on a phone, left to right: the big middle button is "move". */
export const MOBILE_NAV_KEYS: readonly NavKey[] = ['home', 'stock', 'move', 'apartments', 'more']

const byKey = (key: NavKey): NavItem => NAV_ITEMS.find((i) => i.key === key) as NavItem

export const MOBILE_NAV_ITEMS: readonly NavItem[] = MOBILE_NAV_KEYS.map(byKey)

/** Sidebar items of a group. "Move" has its own big button there, so it is not repeated in the list. */
export function sidebarItems(group: NavGroup): NavItem[] {
  return NAV_ITEMS.filter((i) => i.group === group && i.key !== 'move')
}

function matches(pathname: string, item: NavItem): boolean {
  if (item.end) return pathname === item.to
  return pathname === item.to || pathname.startsWith(item.to + '/')
}

/**
 * Whether the item is the current one. Among the visible items the most specific path wins, so "More"
 * is not lit on /admin/more/incidents when the sidebar has its own "Incidents" item, but it is lit
 * for every /admin/more/* page on a phone, where there is no such item.
 */
export function isNavActive(pathname: string, item: NavItem, visible: readonly NavItem[] = NAV_ITEMS): boolean {
  if (!matches(pathname, item)) return false
  return !visible.some((o) => o !== item && o.to.length > item.to.length && matches(pathname, o))
}

/** Text for a counter pill; null = show nothing (zero, or the number is not known). */
export function formatBadge(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null
  return n > 99 ? '99+' : String(Math.floor(n))
}

/** Sum for the "More" tab on a phone: everything that waits for a decision. Unknown counts as 0. */
export function totalBadge(c: NavCounts): number {
  return (c.incidents ?? 0) + (c.cleanings ?? 0)
}

export type MoreKey =
  | 'orders' | 'inventory' | 'documents' | 'catalog'
  | 'incidents' | 'cleaningApprovals' | 'reports' | 'history'
  | 'normTemplates' | 'qr' | 'contacts'
  | 'staff' | 'users'
export type MoreSectionKey = 'warehouse' | 'control' | 'directories' | 'admin'

export interface MoreItem {
  key: MoreKey
  to: string
  badge?: BadgeKey
}

export interface MoreSection {
  key: MoreSectionKey
  items: readonly MoreItem[]
}

/** The "More" page: every sub-page of /admin/more, grouped by what the person is doing there. */
export const MORE_SECTIONS: readonly MoreSection[] = [
  {
    key: 'warehouse',
    items: [
      { key: 'orders', to: '/admin/more/orders' },
      { key: 'inventory', to: '/admin/more/inventory' },
      { key: 'documents', to: '/admin/more/documents' },
      { key: 'catalog', to: '/admin/more/catalog' },
    ],
  },
  {
    key: 'control',
    items: [
      { key: 'incidents', to: '/admin/more/incidents', badge: 'incidents' },
      { key: 'cleaningApprovals', to: '/admin/more/cleaning-approvals', badge: 'cleanings' },
      { key: 'reports', to: '/admin/more/reports' },
      { key: 'history', to: '/admin/more/history' },
    ],
  },
  {
    key: 'directories',
    items: [
      { key: 'normTemplates', to: '/admin/more/norm-templates' },
      { key: 'qr', to: '/admin/more/qr' },
      { key: 'contacts', to: '/admin/more/contacts' },
    ],
  },
  {
    key: 'admin',
    items: [
      { key: 'staff', to: '/admin/more/staff' },
      { key: 'users', to: '/admin/more/users' },
    ],
  },
]

const MORE_ITEMS: readonly MoreItem[] = MORE_SECTIONS.flatMap((s) => s.items)

export type TitleKey = NavKey | MoreKey

/**
 * Which section the page belongs to, for the title of the phone top bar. A main navigation item wins; then a page
 * of the "More" list; then "More" itself. null for an unknown path.
 */
export function titleKeyFor(pathname: string): TitleKey | null {
  const nav = NAV_ITEMS.filter((i) => i.key !== 'more').find((i) => isNavActive(pathname, i))
  if (nav) return nav.key
  const more = MORE_ITEMS.find((i) => pathname === i.to || pathname.startsWith(i.to + '/'))
  if (more) return more.key
  const hub = NAV_ITEMS.find((i) => i.key === 'more')
  return hub && isNavActive(pathname, hub) ? 'more' : null
}
