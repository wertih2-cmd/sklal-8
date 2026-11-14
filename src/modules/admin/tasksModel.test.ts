import { describe, expect, it } from 'vitest'
import {
  canCreateTask, canDeleteTask, countOpen, filterTasks, isOverdue, nextStatus, parseTask, prevStatus,
  sortTasks, taskWhatsappText, validateTaskForm, type Task,
} from './tasksModel'

const mk = (over: Partial<Task>): Task => ({
  id: 1, apartment_id: null, task_date: '2026-11-10', kind: 'other', body: 'x', due_date: null, status: 'new',
  created_by_name: null, created_at: '', accepted_by_name: null, accepted_at: null, done_by_name: null, done_at: null, ...over,
})
const today = '2026-11-14'

describe('parseTask', () => {
  it('reads a row, turns blanks into null, refuses a wrong kind or status', () => {
    const t = parseTask({ id: '7', apartment_id: 3, task_date: '2026-11-14', kind: 'cleaning', body: 'b', due_date: '', status: 'accepted', created_at: 'z' })
    expect(t).toMatchObject({ id: 7, apartment_id: 3, due_date: null, status: 'accepted' })
    expect(parseTask({ id: 1, kind: 'photo', status: 'new' })).toBeNull()
    expect(parseTask({ id: 1, kind: 'other', status: 'closed' })).toBeNull()
  })
})

describe('isOverdue / sortTasks / filterTasks', () => {
  const late = mk({ id: 1, due_date: '2026-11-12' })
  const soon = mk({ id: 2, due_date: '2026-11-16' })
  const later = mk({ id: 3, due_date: '2026-11-20' })
  const none = mk({ id: 4 })
  const done = mk({ id: 5, status: 'done', due_date: '2026-11-01' })
  it('a done task is never overdue', () => {
    expect(isOverdue(late, today)).toBe(true)
    expect(isOverdue(done, today)).toBe(false)
    expect(isOverdue(mk({ due_date: today }), today)).toBe(false)
  })
  it('overdue first, then by due date with no date last, done tasks at the end', () => {
    expect(sortTasks([done, none, later, soon, late], today).map((t) => t.id)).toEqual([1, 2, 3, 4, 5])
  })
  it('filters open and done and counts open', () => {
    expect(filterTasks([late, done], 'active').map((t) => t.id)).toEqual([1])
    expect(filterTasks([late, done], 'done').map((t) => t.id)).toEqual([5])
    expect(filterTasks([late, done], 'all')).toHaveLength(2)
    expect(countOpen([late, soon, done])).toBe(2)
  })
})

describe('what each role may do', () => {
  it('steps forward by one for everybody, back only for manager and admin', () => {
    expect(nextStatus(mk({ status: 'new' }))).toBe('accepted')
    expect(nextStatus(mk({ status: 'accepted' }))).toBe('done')
    expect(nextStatus(mk({ status: 'done' }))).toBeNull()
    expect(prevStatus('supervisor', mk({ status: 'done' }))).toBeNull()
    expect(prevStatus('manager', mk({ status: 'done' }))).toBe('accepted')
    expect(prevStatus('admin', mk({ status: 'accepted' }))).toBe('new')
    expect(prevStatus('admin', mk({ status: 'new' }))).toBeNull()
  })
  it('manager creates, deletes only a new task; admin deletes any; supervisor neither', () => {
    expect(canCreateTask('supervisor')).toBe(false)
    expect(canCreateTask('manager')).toBe(true)
    expect(canDeleteTask('manager', mk({ status: 'new' }))).toBe(true)
    expect(canDeleteTask('manager', mk({ status: 'accepted' }))).toBe(false)
    expect(canDeleteTask('admin', mk({ status: 'done' }))).toBe(true)
    expect(canDeleteTask('supervisor', mk({ status: 'new' }))).toBe(false)
  })
})

describe('validateTaskForm', () => {
  const ok = { kind: 'other' as const, apartmentId: null, date: '2026-11-14', due: '', body: 'text' }
  it('accepts a good form and finds each problem', () => {
    expect(validateTaskForm(ok)).toBeNull()
    expect(validateTaskForm({ ...ok, body: '  ' })).toBe('body')
    expect(validateTaskForm({ ...ok, body: 'x'.repeat(2001) })).toBe('bodyLong')
    expect(validateTaskForm({ ...ok, date: '' })).toBe('date')
    expect(validateTaskForm({ ...ok, due: '2026-11-13' })).toBe('due')
    expect(validateTaskForm({ ...ok, due: '2026-11-14' })).toBeNull()
  })
})

describe('taskWhatsappText', () => {
  it('builds the message with the apartment and the due date only when they exist', () => {
    const l = { title: 'Task', apartment: 'Apt', date: 'Date', due: 'Due', kindName: { cleaning: 'Cleaning', inspection: 'Check', other: 'Other' } }
    const f = (s: string) => s
    expect(taskWhatsappText(mk({ kind: 'cleaning', body: 'Do it', due_date: '2026-11-15' }), 'A/1', l, f))
      .toBe('Task: Cleaning\nApt: A/1\nDate: 2026-11-10\nDue: 2026-11-15\n\nDo it')
    expect(taskWhatsappText(mk({ body: 'B' }), null, l, f)).toBe('Task: Other\nDate: 2026-11-10\n\nB')
  })
})
