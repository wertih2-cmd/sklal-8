export type ReportTab = 'expense' | 'stock' | 'moves' | 'charges' | 'valuation' | 'turnover' | 'units'
export type ReportPeriod = 'today' | '7' | '30' | 'custom'
/** periods that can be passed in a link (a custom range needs explicit dates) */
export type PresetPeriod = Exclude<ReportPeriod, 'custom'>

export const REPORTS_PATH = '/admin/more/reports'
export const REPORT_TABS: ReportTab[] = ['expense', 'stock', 'moves', 'charges', 'valuation', 'turnover', 'units']
export const PRESET_PERIODS: PresetPeriod[] = ['today', '7', '30']

/** Tabs whose content depends on the selected period (the others show the current state). */
export const PERIOD_TABS: ReportTab[] = ['expense', 'moves', 'charges', 'turnover']

export function parseReportTab(value: string | null): ReportTab {
  return REPORT_TABS.find((tab) => tab === value) ?? 'expense'
}

export function parseReportPeriod(value: string | null): ReportPeriod {
  return PRESET_PERIODS.find((period) => period === value) ?? '7'
}

export function reportLink(tab: ReportTab, period?: PresetPeriod): string {
  const params = new URLSearchParams({ tab })
  if (period) params.set('period', period)
  return `${REPORTS_PATH}?${params.toString()}`
}
