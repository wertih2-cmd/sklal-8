import { describe, it, expect } from 'vitest'
import { scanSource } from './rules'

const rules = (src: string, file = 'modules/x/Page.tsx') => scanSource(file, src).map((v) => v.rule)

describe('arbitrary z-index', () => {
  it('flags z-[..] and z-50, also with variants', () => {
    expect(rules('<div className="fixed z-[70]" />')).toEqual(['arbitrary-z'])
    expect(rules('<div className="fixed z-50" />')).toEqual(['arbitrary-z'])
    expect(rules('<div className="md:z-[45] p-2" />')).toEqual(['arbitrary-z'])
  })
  it('allows the named scale and lookalikes', () => {
    expect(rules('<div className="z-modal" />')).toEqual([])
    expect(rules('<div className="z-toast z-nav z-drawer z-confirm" />')).toEqual([])
    expect(rules('<div className="z-10 -z-10 z-500x" />')).toEqual([])
  })
  it('ignores comments', () => {
    expect(rules('// old: z-[70]')).toEqual([])
    expect(rules('/* z-50 */ const a = 1')).toEqual([])
    expect(rules('/*\n z-[45]\n*/\nconst a = 1')).toEqual([])
  })
})

describe('text-white on solid fills', () => {
  it('flags text-white next to a solid fill', () => {
    expect(rules('<button className="bg-accent text-white" />')).toEqual(['text-white-on-fill'])
    expect(rules('<b className={a ? "bg-bad text-white" : ""} />')).toEqual(['text-white-on-fill'])
    expect(rules('<b className="hover:bg-ok text-white" />')).toEqual(['text-white-on-fill'])
  })
  it('allows text-on-accent, soft fills, opacity fills and dark overlays', () => {
    expect(rules('<button className="bg-accent text-on-accent" />')).toEqual([])
    expect(rules('<b className="bg-bad-soft text-white" />')).toEqual([])
    expect(rules('<b className="bg-accent/10 text-white" />')).toEqual([])
    expect(rules('<div className="bg-black text-white" />')).toEqual([])
    expect(rules('<p className="text-white/70" />')).toEqual([])
    expect(rules('<Loader2 className="w-6 h-6 text-white animate-spin" />')).toEqual([])
  })
})

describe('physical RTL classes', () => {
  it('flags physical direction classes', () => {
    for (const c of ['text-left', 'text-right', 'ml-2', 'mr-auto', 'pl-9', 'pr-4', '-ml-1', 'left-3', 'right-0', 'border-l', 'border-r', 'rounded-l-lg', 'rounded-tr-xl', 'lg:right-8', 'translate-x-2']) {
      expect(rules(`<div className="${c}" />`), c).toEqual(['physical-rtl'])
    }
  })
  it('allows logical classes and lookalikes', () => {
    for (const c of ['text-start', 'text-end', 'ms-2', 'me-auto', 'ps-9', 'pe-4', '-ms-1', 'start-3', 'end-0', 'border-s', 'border-line', 'rounded-lg', 'rounded-s-lg', 'inset-x-0', 'px-3', 'left-to-right', 'rtl:rotate-180']) {
      expect(rules(`<div className="${c}" />`), c).toEqual([])
    }
  })
  it('allows centring in Modal only', () => {
    const line = '<div className="absolute left-1/2 -translate-x-1/2" />'
    expect(rules(line, 'components/Modal.tsx')).toEqual([])
    expect(rules(line, 'modules/x/Other.tsx')).toEqual(['physical-rtl', 'physical-rtl'].slice(0, 1))
  })
  it('reports line numbers', () => {
    const v = scanSource('a.tsx', 'ok\n<div className="text-left" />')
    expect(v[0].line).toBe(2)
  })
})
