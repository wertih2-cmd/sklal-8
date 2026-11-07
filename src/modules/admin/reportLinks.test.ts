import { describe, it, expect } from 'vitest'
import {
  REPORT_TABS, PERIOD_TABS, parseReportTab, parseReportPeriod, reportLink,
} from './reportLinks'

describe('parseReportTab', () => {
  it('accepts every known tab', () => {
    for (const tab of REPORT_TABS) expect(parseReportTab(tab)).toBe(tab)
  })

  it('falls back to expense for unknown or missing values', () => {
    expect(parseReportTab(null)).toBe('expense')
    expect(parseReportTab('nope')).toBe('expense')
    expect(parseReportTab('')).toBe('expense')
  })
})

describe('parseReportPeriod', () => {
  it('accepts the preset periods', () => {
    expect(parseReportPeriod('today')).toBe('today')
    expect(parseReportPeriod('7')).toBe('7')
    expect(parseReportPeriod('30')).toBe('30')
  })

  it('falls back to 7 days; custom cannot be requested through a link', () => {
    expect(parseReportPeriod(null)).toBe('7')
    expect(parseReportPeriod('custom')).toBe('7')
    expect(parseReportPeriod('90')).toBe('7')
  })
})

describe('reportLink', () => {
  it('builds a link with the tab only', () => {
    expect(reportLink('valuation')).toBe('/admin/more/reports?tab=valuation')
  })

  it('adds the period when given', () => {
    expect(reportLink('expense', '30')).toBe('/admin/more/reports?tab=expense&period=30')
  })

  it('round-trips through the parsers', () => {
    const params = new URLSearchParams(reportLink('charges', 'today').split('?')[1])
    expect(parseReportTab(params.get('tab'))).toBe('charges')
    expect(parseReportPeriod(params.get('period'))).toBe('today')
  })
})

describe('PERIOD_TABS', () => {
  it('only lists real tabs', () => {
    for (const tab of PERIOD_TABS) expect(REPORT_TABS.includes(tab)).toBe(true)
  })
})
