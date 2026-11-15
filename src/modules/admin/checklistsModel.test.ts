import { describe, it, expect } from 'vitest'
import type { CleaningFeedRow } from './cleaningFeed'
import {
  answeredAll, areaOf, buildResults, canDeleteInspection, canEditTemplate, canRecheck, cleaningsToInspect, draftFromItems,
  emptyResults, failedCount, inspectionsPath, isTemplateChanged, moveItem, noteTooLong, openReworkItems, parseChecklistItem,
  parseInspection, tasksPath, templatesPath, toSaveItems, validateRecheck, validateTemplate,
  type ChecklistItem, type Inspection, type TemplateDraftItem,
} from './checklistsModel'

const item = (id: number, position: number, body = `p${id}`): ChecklistItem => ({ id, apt_type: 'studio', position, body })
const draft = (id: number | null, text: string): TemplateDraftItem => ({ key: String(id ?? text), id, text })

describe('parsers', () => {
  it('a check list item needs a known apartment type', () => {
    expect(parseChecklistItem({ id: 1, apt_type: 'studio', position: 2, body: 'x' })).toEqual({ id: 1, apt_type: 'studio', position: 2, body: 'x' })
    expect(parseChecklistItem({ id: 1, apt_type: '3br', position: 1, body: 'x' })).toBeNull()
  })
  it('an inspection comes with its items in the order of the check list', () => {
    const i = parseInspection({
      id: 5, cleaning_event_id: 'e1', apartment_id: 9, status: 'needs_rework', inspector_name: 'Ann', inspected_at: '2026-11-10T10:00:00Z',
      inspection_items: [
        { id: 12, inspection_id: 5, position: 2, body: 'b', ok: false, note: 'dust', photo_paths: ['u/a.jpg'], task_id: 7, resolved_at: null, recheck_count: 0 },
        { id: 11, inspection_id: 5, position: 1, body: 'a', ok: true, photo_paths: null },
      ],
    })!
    expect(i.status).toBe('needs_rework')
    expect(i.items.map((x) => x.id)).toEqual([11, 12])
    expect(i.items[1].photo_paths).toEqual(['u/a.jpg'])
    expect(i.items[0].photo_paths).toEqual([])
    expect(i.items[1].task_id).toBe(7)
    expect(i.items[0].note).toBeNull()
  })
  it('a row without the cleaning id is not an inspection', () => {
    expect(parseInspection({ id: 1 })).toBeNull()
  })
})

describe('roles', () => {
  it('the manager and the admin edit templates and delete inspections, the supervisor does not', () => {
    expect(canEditTemplate('manager')).toBe(true)
    expect(canEditTemplate('admin')).toBe(true)
    expect(canEditTemplate('supervisor')).toBe(false)
    expect(canDeleteInspection('supervisor')).toBe(false)
    expect(canDeleteInspection('manager')).toBe(true)
  })
})

describe('template editor', () => {
  it('validation: empty, long, too many', () => {
    expect(validateTemplate([draft(1, 'ok')])).toBeNull()
    expect(validateTemplate([draft(1, 'ok'), draft(null, '   ')])).toBe('empty')
    expect(validateTemplate([draft(1, 'x'.repeat(201))])).toBe('long')
    expect(validateTemplate([draft(1, 'x'.repeat(200))])).toBeNull()
    expect(validateTemplate(Array.from({ length: 61 }, (_, i) => draft(i, 'a')))).toBe('tooMany')
    expect(validateTemplate([])).toBeNull()
  })
  it('save payload keeps the order, ids of saved items and trims', () => {
    expect(toSaveItems([draft(5, ' a '), draft(null, 'b')])).toEqual([{ id: 5, text: 'a' }, { text: 'b' }])
  })
  it('draftFromItems sorts by position', () => {
    expect(draftFromItems([item(2, 2), item(1, 1)]).map((d) => d.id)).toEqual([1, 2])
  })
  it('moveItem swaps and stops at the edges', () => {
    expect(moveItem([1, 2, 3], 1, -1)).toEqual([2, 1, 3])
    expect(moveItem([1, 2, 3], 1, 1)).toEqual([1, 3, 2])
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3])
    expect(moveItem([1, 2, 3], 2, 1)).toEqual([1, 2, 3])
  })
  it('changes: text, order, added, removed; trimming does not count', () => {
    const saved = [item(1, 1, 'a'), item(2, 2, 'b')]
    expect(isTemplateChanged(saved, draftFromItems(saved))).toBe(false)
    expect(isTemplateChanged(saved, [draft(1, 'a '), draft(2, 'b')])).toBe(false)
    expect(isTemplateChanged(saved, [draft(1, 'a'), draft(2, 'c')])).toBe(true)
    expect(isTemplateChanged(saved, [draft(2, 'b'), draft(1, 'a')])).toBe(true)
    expect(isTemplateChanged(saved, [draft(1, 'a')])).toBe(true)
    expect(isTemplateChanged(saved, [draft(1, 'a'), draft(2, 'b'), draft(null, 'c')])).toBe(true)
  })
})

describe('inspection form', () => {
  const items = [item(1, 1), item(2, 2), item(3, 3)]
  it('starts unanswered and needs every answer', () => {
    const r = emptyResults(items)
    expect(answeredAll(r)).toBe(false)
    expect(answeredAll([])).toBe(false)
    r[0].ok = true; r[1].ok = false
    expect(answeredAll(r)).toBe(false)
    r[2].ok = true
    expect(answeredAll(r)).toBe(true)
    expect(failedCount(r)).toBe(1)
  })
  it('buildResults trims notes and attaches the photos of each item', () => {
    const r = emptyResults(items)
    r[0].ok = true; r[1].ok = false; r[1].note = '  dust  '; r[2].ok = true
    const out = buildResults(r, new Map([[2, ['u/x.jpg']]]))
    expect(out).toEqual([
      { item_id: 1, ok: true, note: '', photos: [] },
      { item_id: 2, ok: false, note: 'dust', photos: ['u/x.jpg'] },
      { item_id: 3, ok: true, note: '', photos: [] },
    ])
  })
  it('a note over 500 characters is too long', () => {
    expect(noteTooLong('x'.repeat(500))).toBe(false)
    expect(noteTooLong('x'.repeat(501))).toBe(true)
  })
})

describe('re-check', () => {
  it('needs a choice, and a reason when the item is not fixed', () => {
    expect(validateRecheck(null, '')).toBe('choose')
    expect(validateRecheck(true, '')).toBeNull()
    expect(validateRecheck(false, '  ')).toBe('note')
    expect(validateRecheck(false, 'still dusty')).toBeNull()
    expect(validateRecheck(true, 'x'.repeat(501))).toBe('noteLong')
  })
  it('possible only for a failed, unclosed item whose rework is done or gone', () => {
    const failed = { ok: false, resolved_at: null }
    expect(canRecheck(failed, 'done')).toBe(true)
    expect(canRecheck(failed, null)).toBe(true)
    expect(canRecheck(failed, 'new')).toBe(false)
    expect(canRecheck(failed, 'accepted')).toBe(false)
    expect(canRecheck(failed, 'verified')).toBe(false)
    expect(canRecheck({ ok: true, resolved_at: null }, 'done')).toBe(false)
    expect(canRecheck({ ok: false, resolved_at: '2026-11-11T10:00:00Z' }, 'done')).toBe(false)
  })
})

function insp(id: number, at: string, items: Array<[number, boolean, string | null]>): Inspection {
  return {
    id, cleaning_event_id: `e${id}`, apartment_id: 1, status: 'needs_rework', inspector_name: null, inspected_at: at,
    items: items.map(([pos, ok, resolved]) => ({
      id: id * 100 + pos, inspection_id: id, position: pos, body: 'b', ok, note: null, photo_paths: [], task_id: null,
      resolved_at: resolved, resolved_by_name: null, recheck_note: null, recheck_count: 0, recheck_photo_paths: [],
    })),
  }
}

describe('openReworkItems', () => {
  it('lists failed and unclosed items, newest inspection first', () => {
    const list = openReworkItems([
      insp(1, '2026-11-10T10:00:00Z', [[1, false, null], [2, true, null]]),
      insp(2, '2026-11-12T10:00:00Z', [[1, false, '2026-11-13T10:00:00Z'], [2, false, null]]),
    ])
    expect(list.map((e) => e.item.id)).toEqual([202, 101])
  })
  it('nothing when every failed item is closed', () => {
    expect(openReworkItems([insp(1, '2026-11-10T10:00:00Z', [[1, false, '2026-11-11T10:00:00Z']])])).toEqual([])
  })
})

describe('cleaningsToInspect', () => {
  const c = (id: string, at: string, over: Partial<CleaningFeedRow> = {}): CleaningFeedRow => ({
    id, apartment_id: 1, cleaned_at: at, status: 'done', posting_status: 'posted', note: null, media_count: 0, staff_names: [], ...over,
  })
  it('skips inspected, rejected and reversed cleanings and sorts the newest first; pending ones stay', () => {
    const list = cleaningsToInspect(
      [
        c('a', '2026-11-10T08:00:00Z'),
        c('b', '2026-11-12T08:00:00Z', { posting_status: 'pending' }),
        c('c', '2026-11-11T08:00:00Z', { posting_status: 'rejected' }),
        c('d', '2026-11-11T09:00:00Z', { status: 'reversed' }),
        c('e', '2026-11-09T08:00:00Z'),
      ],
      [{ cleaning_event_id: 'e' }],
    )
    expect(list.map((x) => x.id)).toEqual(['b', 'a'])
  })
})

describe('paths', () => {
  it('the area follows the address, and each area has its own screens', () => {
    expect(areaOf('/admin/more/tasks')).toBe('admin')
    expect(areaOf('/manager/tasks')).toBe('manager')
    expect(areaOf('/sv/inspections')).toBe('sv')
    expect(inspectionsPath('admin')).toBe('/admin/more/inspections')
    expect(inspectionsPath('manager')).toBe('/manager/inspections')
    expect(templatesPath('sv')).toBe('/sv/inspections/templates')
    expect(tasksPath('manager')).toBe('/manager/tasks')
    expect(tasksPath('admin')).toBe('/admin/more/tasks')
  })
})
