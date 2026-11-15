import { describe, expect, it } from 'vitest'
import {
  canCreateTask, canDeleteTask, countOpen, filterTasks, isClosed, isOverdue, MANUAL_TASK_KINDS, nextStatus, parseTask, prevStatus,
  sortTasks, TASK_KINDS, taskWhatsappText, validateTaskForm, type Task,
} from './tasksModel'

const mk = (over: Partial<Task>): Task => ({
  id: 1, apartment_id: null, task_date: '2026-11-10', kind: 'other', body: 'x', due_date: null, status: 'new',
  created_by_name: null, created_at: '', accepted_by_name: null, accepted_at: null, done_by_name: null, done_at: null,
  verified_by_name: null, verified_at: null, return_note: null, ...over,
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
    const l = { title: 'Task', apartment: 'Apt', date: 'Date', due: 'Due', kindName: { cleaning: 'Cleaning', inspection: 'Check', other: 'Other', rework: 'Rework' } }
    const f = (s: string) => s
    expect(taskWhatsappText(mk({ kind: 'cleaning', body: 'Do it', due_date: '2026-11-15' }), 'A/1', l, f))
      .toBe('Task: Cleaning\nApt: A/1\nDate: 2026-11-10\nDue: 2026-11-15\n\nDo it')
    expect(taskWhatsappText(mk({ body: 'B' }), null, l, f)).toBe('Task: Other\nDate: 2026-11-10\n\nB')
  })
})

describe('rework tasks and the verified status', () => {
  const base = {
    id: 1, task_date: '2026-11-10', kind: 'rework', body: 'x', due_date: null, status: 'new', created_by_name: null, created_at: '',
    accepted_by_name: null, accepted_at: null, done_by_name: null, done_at: null,
  }
  it('parseTask knows the rework kind and the verified status and reads the new fields', () => {
    const t = parseTask({ ...base, kind: 'rework', status: 'verified', verified_by_name: 'Ann', verified_at: '2026-11-11T10:00:00Z', return_note: '' })
    expect(t?.kind).toBe('rework')
    expect(t?.status).toBe('verified')
    expect(t?.verified_by_name).toBe('Ann')
    expect(t?.return_note).toBeNull()
  })
  it('parseTask still rejects an unknown kind or status', () => {
    expect(parseTask({ ...base, kind: 'weird' })).toBeNull()
    expect(parseTask({ ...base, status: 'weird' })).toBeNull()
  })
  it('a verified task is closed: not open, not overdue, in the done filter', () => {
    const t = parseTask({ ...base, status: 'verified', due_date: '2026-11-01' })!
    expect(isClosed(t)).toBe(true)
    expect(isOverdue(t, '2026-11-14')).toBe(false)
    expect(filterTasks([t], 'done')).toHaveLength(1)
    expect(filterTasks([t], 'active')).toHaveLength(0)
    expect(countOpen([t])).toBe(0)
  })
  it('nobody steps a verified task forward or back, and only the admin deletes it', () => {
    const t = parseTask({ ...base, status: 'verified' })!
    expect(nextStatus(t)).toBeNull()
    expect(prevStatus('manager', t)).toBeNull()
    expect(prevStatus('admin', t)).toBeNull()
    expect(canDeleteTask('manager', t)).toBe(false)
    expect(canDeleteTask('admin', t)).toBe(true)
  })
  it('closed tasks go after the open ones', () => {
    const open = parseTask({ ...base, id: 1, status: 'accepted' })!
    const verified = parseTask({ ...base, id: 2, status: 'verified' })!
    expect(sortTasks([verified, open], '2026-11-14').map((x) => x.id)).toEqual([1, 2])
  })
  it('manual kinds do not include rework', () => {
    expect(MANUAL_TASK_KINDS).not.toContain('rework')
    expect(TASK_KINDS).toContain('rework')
  })
})
