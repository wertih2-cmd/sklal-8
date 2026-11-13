import { describe, it, expect } from 'vitest'
import { filterApartments, searchKey } from './apartmentSearch'

const apts = ['A1/202', 'A1/203', 'B2/101', 'C1/202'].map((code, id) => ({ id, code }))
const codes = (r: { code: string }[]) => r.map((a) => a.code)

describe('searchKey', () => {
  it('ignores case, spaces and separators', () => {
    expect(searchKey(' a1 / 202 ')).toBe('a1202')
    expect(searchKey('A1-202')).toBe('a1202')
  })
  it('treats Cyrillic lookalikes as Latin', () => {
    expect(searchKey('А1/202')).toBe(searchKey('A1/202'))
    expect(searchKey('Вс')).toBe('bc')
  })
})

describe('filterApartments', () => {
  it('empty query gives the first items, limited', () => {
    expect(codes(filterApartments(apts, '', 2))).toEqual(['A1/202', 'A1/203'])
    expect(codes(filterApartments(apts, '   '))).toHaveLength(4)
  })
  it('prefix matches come before inner ones', () => {
    expect(codes(filterApartments(apts, '202'))).toEqual(['A1/202', 'C1/202'])
    expect(codes(filterApartments(apts, 'a1'))).toEqual(['A1/202', 'A1/203'])
    expect(codes(filterApartments(apts, '1'))).toEqual(['A1/202', 'A1/203', 'B2/101', 'C1/202'])
  })
  it('finds a code typed in the other layout', () => {
    expect(codes(filterApartments(apts, 'в2'))).toEqual(['B2/101'])
  })
  it('nothing found', () => {
    expect(filterApartments(apts, 'zzz')).toEqual([])
  })
  it('respects the limit', () => {
    expect(filterApartments(apts, '1', 2)).toHaveLength(2)
  })
})
