import type { CommandRunInput, On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import { bar, colorOf, metersOf, untilReset } from './register'

test('meter is 16 dithered cells', () => {
  for (const p of [0, 3, 41, 91, 100, 140]) {
    const b = bar(p)
    expect(b.fill.length + b.rest.length).toBe(16)
  }
  expect(bar(50).fill).toBe('⣿'.repeat(8))
  expect(colorOf(3)).toBe('green')
  expect(colorOf(91)).toBe('red')
})

// Eye marks on a row: an orange half-block with no bg (its other half is a hole) beside more body, an
// inverse eye glyph, or a pair of quadrant holes.
const BODY = ['#d97757', '#be684d']
function eyeMarks(row: [string, string | null, string | null, boolean?][]): number {
  const cells = row.flatMap(([s, fg, bg, inv]) => [...s].map(ch => ({ ch, fg, bg, inv: !!inv })))
  const body = (i: number) => {
    const c = cells[i]
    return c !== undefined && c.ch !== ' ' && BODY.includes(c.fg ?? '')
  }
  let n = 0
  cells.forEach((c, i) => {
    if (c.inv && (c.ch === '▂' || c.ch === '^')) n += 1
    else if ('▛▜▙▟'.includes(c.ch)) n += 0.5
    else if ((c.ch === '▀' || c.ch === '▄') && !c.bg && c.fg === BODY[0] && (body(i - 1) || body(i + 1))) n += 1
  })
  return n
}

test('every clawd frame is 4 rows of 16 cells and keeps a face', () => {
  for (const [name, clip] of Object.entries(CLIPS)) {
    expect(clip.face.length).toBe(clip.frames.length)
    clip.frames.forEach((f, i) => {
      expect(f.length).toBe(4)
      for (const row of f) expect(row.reduce((a, [s]) => a + [...s].length, 0)).toBe(16)
      const face = clip.face[i]
      const row = face === undefined ? undefined : f[face]
      if (!row || eyeMarks(row) < 2) throw new Error(`${name}[${i}] has no face`)
    })
  }
})

test('countdown and meters', () => {
  const now = Date.parse('2026-10-04T00:00:00Z')
  expect(untilReset('2026-10-04T03:03:00Z', now)).toBe('3h3m')
  const ms = metersOf({ startedAt: 0, rateLimits: [{ kind: 'five_hour', percentUsed: 3 }, { kind: 'seven_day', percentUsed: 91 }], context: { tokens: 407_000, window: 1_000_000, percent: 40.7 } } as never, now)
  expect(ms.map(m => m.label)).toEqual(['5H', '7D', 'CTX'])
  expect(ms[2]?.note).toBe('407k / 1M')
})

import { clipFor, clipMs, frameIndex, isEmpty } from './register'
import { CLIPS } from './frames'

function clipNamed(name: string) {
  const clip = CLIPS[name]
  if (!clip) throw new Error(`no clip named ${name}`)
  return clip
}

test('clawd plays the right clip for the state', () => {
  const base = { working: false, nowMs: 100_000, lastToolMs: 99_000, lastActiveMs: 90_000, happyUntilMs: 0, turnStartMs: 90_000 }
  expect(clipFor({ ...base, working: true })).toBe('typing')
  expect(clipFor({ ...base, working: true, lastToolMs: 80_000 })).toBe('think')
  expect(clipFor({ ...base, happyUntilMs: 101_000 })).toBe('happy')
  expect(clipFor({ ...base, lastActiveMs: 0, turnStartMs: 0, nowMs: 700_000 })).toBe('doze')
  expect(['look', 'wave', 'yawn']).toContain(clipFor(base))
  // turn.start: the official app's lead-in plays once (pull the laptop out, hop, sit), then typing
  expect(clipFor({ ...base, working: true, turnStartMs: 99_500, lastActiveMs: 99_500 })).toBe('typing-start')
  expect(clipFor({ ...base, working: true, turnStartMs: 100_000 - clipMs('typing-start') - 1, lastActiveMs: 90_000 })).toBe('typing')
  // turn.complete: the lead-out plays once, then happy
  const done = { ...base, endStartMs: 99_900, happyUntilMs: 99_900 + clipMs('typing-end') + 3_000 }
  expect(clipFor(done)).toBe('typing-end')
  expect(clipFor({ ...done, nowMs: 99_900 + clipMs('typing-end') + 1 })).toBe('happy')
  expect(clipFor({ ...done, working: true, turnStartMs: 50_000 })).not.toBe('typing-end')
  // working reported before turn.start: the last turn's stamp is older than its completion
  expect(clipFor({ ...base, working: true, turnStartMs: 50_000, lastActiveMs: 60_000 })).toBe('walk')
  expect(clipFor({ ...base, nowMs: 8_000, lastActiveMs: 7_000, turnStartMs: 7_000 })).toBe('wave')
  for (const name of ['typing', 'typing-start', 'typing-end', 'think', 'happy', 'doze', 'look', 'yawn', 'wave', 'walk']) {
    const clip = clipNamed(name)
    expect(clip.frames.length).toBeGreaterThan(3)
    expect(frameIndex(name, 123_456)).toBeLessThan(clip.frames.length)
  }
})

import { cacheHit } from './register'
test('cache hit share matches token-ledger', () => {
  expect(cacheHit({ input_tokens: 10, cache_read_input_tokens: 75, cache_creation_input_tokens: 15 })).toBe(75)
  expect(cacheHit({})).toBe(null)
  expect(cacheHit(undefined)).toBe(null)
})

import { cacheLeft } from './register'
test('cache warmth counts down the 1h TTL', () => {
  const t0 = 1_000_000
  expect(cacheLeft(t0 + 10 * 60_000, t0).text).toBe('warm 50m')
  expect(cacheLeft(t0 + 50 * 60_000, t0).color).toBe('yellow')
  expect(cacheLeft(t0 + 57 * 60_000, t0).color).toBe('red')
  expect(cacheLeft(t0 + 61 * 60_000, t0).text).toBe('cold')
})

test('one-shot clips play once from their start and hold the last frame', () => {
  const n = clipNamed('typing-start').frames.length
  expect(frameIndex('typing-start', 5_000, 5_000)).toBe(0)
  expect(frameIndex('typing-start', 5_100, 5_000)).toBe(1)
  expect(frameIndex('typing-start', 60_000, 5_000)).toBe(n - 1)
  expect(clipMs('typing-start')).toBe((n * 1000) / 12)
})

test('an empty rest-of-chain is told apart from another plugin\'s tree', () => {
  for (const n of [null, undefined, false, '', [], { type: 'Box', props: {}, children: [] }, { type: 'Box', children: [{ type: 'Text', children: [''] }] },
    // what next(e) answers live when no other plugin draws (core's own band)
    { type: 'Box', props: { flexDirection: 'column' }, children: [{ type: 'engine', ref: 1 }] }]) expect(isEmpty(n)).toBe(true)
  expect(isEmpty({ type: 'Text', props: {}, children: ['engine band'] })).toBe(false)
  expect(isEmpty({ type: 'Box', children: [{ type: 'Image', props: {} }] })).toBe(false)
})

const BAND = {
  plugin: 'usage-deck',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const USAGE = { startedAt: 0, rateLimits: [{ kind: 'five_hour', percentUsed: 3 }, { kind: 'seven_day', percentUsed: 41 }] }
// A tall tree from another plugin (image-view's tiles), standing as the rest of the AbovePrompt chain.
const TILES = { type: 'Box', props: { flexDirection: 'column' }, children: Array.from({ length: 9 }, (_, i) => ({ type: 'Text', props: {}, children: [`tile row ${i}`] })) }

function band(on: On, below: unknown) {
  mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('session.usage', () => ({ value: USAGE }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.render', () => below as never)
}

test('alone in the band the deck draws in full', async ($, on) => {
  band(on as never, { type: 'Box', props: {}, children: [] })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '5-HOUR' })).toBeDefined()
})

test('beside another plugin\'s tree the deck shrinks to one row, or steps aside when the band is short', async ($, on) => {
  band(on as never, TILES)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'tile row 8' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '5-HOUR' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /5H/ })).toBeDefined()
  await ui.unmount()
  const short = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, maxRows: 8, scroll: { offset: 0, bodyRows: 8 } } })
  expect(await short.find({ type: 'Text', text: 'tile row 0' })).toBeDefined()
  expect(await short.find({ type: 'Text', text: /5H/ })).toBeUndefined()
})

test('a window missing from usage still shows as a fresh row', () => {
  const ms = metersOf({ startedAt: 0, rateLimits: [{ kind: 'seven_day', percentUsed: 93 }], context: { tokens: 1000, window: 1_000_000, percent: 0.1 } } as never, 0)
  expect(ms.map(m => m.label)).toEqual(['5H', '7D', 'CTX'])
  expect(ms[0]?.note).toBe('new window')
})

// A command the person types at the prompt.
const typed = (command: string): CommandRunInput => ({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

test('/deck hides and shows the deck, and leaves other commands to the rest of the chain', async ($, on) => {
  band(on, { type: 'Box', props: {}, children: [] })
  on('command.run', () => ({ text: 'from below' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect((await $.command.run(typed('deck'))).text).toBe('usage-deck: hidden (/deck shows it again)')
  expect((await $.command.run(typed('deck'))).text).toBe('usage-deck: shown')
  expect((await $.command.run(typed('help'))).text).toBe('from below')
})
