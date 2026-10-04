/* @jsx h */
import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, Register, RenderElement, SessionUsage, TextProps, Timer } from 'claude-code'

import type { Meter } from '../types'
import { CLIPS } from './frames'
import type { Seg } from './frames'

const meters = atom({ plugin: 'usage-deck', key: 'meters' } as const, [] as Meter[])
const isHidden = atom({ plugin: 'usage-deck', key: 'isHidden' } as const, false)
const frame = atom({ plugin: 'usage-deck', key: 'frame' } as const, 0)
const isWorking = atom({ plugin: 'usage-deck', key: 'isWorking' } as const, false)


const BAR_CELLS = 16

// claude.dev dithered meter: dense dots filled, faint dots for the track.
export function bar(percent: number, width = BAR_CELLS): { fill: string; rest: string } {
  const n = Math.max(0, Math.min(width, Math.round((Math.min(percent, 100) / 100) * width)))
  return { fill: '⣿'.repeat(n), rest: '⠒'.repeat(width - n) }
}

export function colorOf(percent: number): string {
  return percent >= 85 ? 'red' : percent >= 60 ? 'yellow' : 'green'
}

export function untilReset(resetsAt: string | undefined, nowMs: number): string {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - nowMs
  if (!Number.isFinite(ms) || ms <= 0) return 'now'
  const m = Math.round(ms / 60_000)
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d${h}h` : h > 0 ? `${h}h${m % 60}m` : `${m}m`
}

function k(n: number): string {
  return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`
}

const LABELS: Record<string, string> = { five_hour: '5H', seven_day: '7D', spend_limit: '$' }

export function metersOf(usage: SessionUsage, nowMs: number): Meter[] {
  const out: Meter[] = (usage.rateLimits ?? [])
    .filter(l => Number.isFinite(l.percentUsed))
    .map(l => ({ label: LABELS[l.kind] ?? l.kind.slice(0, 2), percent: l.percentUsed, note: untilReset(l.resetsAt, nowMs) }))
  // Right after a window resets, the API omits it until it is used again: keep the row as a fresh window.
  for (const [kind, label] of [['five_hour', '5H'], ['seven_day', '7D']] as const) {
    if (!out.some(m => m.label === label)) out.unshift({ label, percent: 0, note: 'new window' })
  }
  out.sort((a, b) => (a.label === '5H' ? -1 : b.label === '5H' ? 1 : 0))
  const c = usage.context
  if (c && c.window > 0) {
    const pct = c.percent ?? ((c.tokens ?? 0) / c.window) * 100
    out.push({ label: 'CTX', percent: pct, note: c.tokens !== undefined ? `${k(c.tokens)} / ${k(c.window)}` : '' })
  }
  return out
}

async function refresh($: EngineInterface): Promise<void> {
  try {
    const usage = await $.session.usage()
    const nowMs = await $.clock.now()
    await update($, meters, () => metersOf(usage, nowMs))
  } catch {
    // keep the last reading
  }
}

// How long a clip plays once through.
export function clipMs(clip: string): number {
  const c = CLIPS[clip]
  return c ? (c.frames.length * 1000) / c.fps : 0
}

// Which clip plays, by state (Clawd on Desk's theme.json mapping, simplified). A turn opens with Clawd
// walking over (claude.dev patrol), then the official app's lead-in (pull the laptop out, sit) once, then
// typing; it ends with the lead-out (laptop away, turn back) once, then happy. Idle cycles look / wave / yawn.
export function clipFor(s: { working: boolean; nowMs: number; lastToolMs: number; lastActiveMs: number; happyUntilMs: number; turnStartMs?: number; endStartMs?: number }): string {
  if (!s.working && s.endStartMs !== undefined && s.nowMs >= s.endStartMs && s.nowMs - s.endStartMs < clipMs('typing-end')) return 'typing-end'
  if (s.nowMs < s.happyUntilMs) return 'happy'
  if (s.working) {
    // The engine reports work a beat before turn.start (turn not stamped yet): walk over, then sit and type.
    const turn = s.turnStartMs ?? 0
    if (turn < s.lastActiveMs) return 'walk'
    if (s.nowMs - turn < clipMs('typing-start')) return 'typing-start'
    return s.nowMs - s.lastToolMs > 8_000 ? 'think' : 'typing'
  }
  if (s.nowMs - s.lastActiveMs > 10 * 60_000) return 'doze'
  return ['look', 'look', 'wave', 'look', 'yawn'][Math.floor(s.nowMs / 4_000) % 5]
}

// One clip row as Text: fg/bg per segment; a 4th `true` draws it inverse, so the glyph is a hole in the
// body (closed and ^ eyes).
function segsOf(Text: ElementConstructor<TextProps>, segs: Seg[]): RenderElement[] {
  return segs.map(([s, fg, bg, inv], j) => (
    <Text key={`s${j}`} {...(fg ? { color: fg } : {})} {...(bg ? { backgroundColor: bg } : {})} {...(inv ? { inverse: true } : {})}>{s}</Text>
  ))
}

// Loops by the clock; with `startMs`, plays once from then and holds the last frame.
export function frameIndex(clip: string, nowMs: number, startMs?: number): number {
  const c = CLIPS[clip]
  if (!c) return 0
  if (startMs === undefined) return Math.floor((nowMs * c.fps) / 1000) % c.frames.length
  return Math.max(0, Math.min(c.frames.length - 1, Math.floor(((nowMs - startMs) * c.fps) / 1000)))
}

// Whether what the rest of the AbovePrompt chain drew holds anything: another plugin's tree (image-view's
// pasted-image tiles, lane-band) wants the band's rows; an empty Box / Text, '' or nothing does not. Alone,
// next(e) answers core's own band, `Box[{ type: 'engine', ref }]` (seen live on 2.1.289), which draws
// nothing without a survey (a survey already hands the band back above).
export function isEmpty(node: unknown): boolean {
  if (node === null || node === undefined || node === false || node === '') return true
  if (typeof node === 'object' && (node as { type?: unknown }).type === 'engine') return true
  if (Array.isArray(node)) return node.every(isEmpty)
  if (typeof node === 'object') {
    const el = node as { type?: unknown; children?: unknown }
    if (el.type === undefined || el.type === 'Box' || el.type === 'Text' || el.type === 'Fragment') return isEmpty(el.children ?? [])
  }
  return false
}
// image-view sizes its tiles to the whole band (at most 6 rows + 3 of border and label): below this many
// rows even the deck's one compact row would push its tiles out of view, so the deck steps aside.
const CROWDED_MIN_ROWS = 10

// Cache hit share of the last turn, as token-ledger computes it: reads over everything read.
export function cacheHit(u: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined): number | null {
  if (!u) return null
  const read = u.cache_read_input_tokens ?? 0
  const over = (u.input_tokens ?? 0) + read + (u.cache_creation_input_tokens ?? 0)
  return over > 0 ? Math.round((read / over) * 100) : null
}

let cachePct: number | null = null
// Prompt cache TTL: this setup runs the 1-hour cache (5 min if the session drops to overage).
const CACHE_TTL_MS = 60 * 60_000
let lastCallMs = 0

export function cacheLeft(nowMs: number, lastMs: number, ttlMs = CACHE_TTL_MS): { text: string; color: string } {
  if (!lastMs) return { text: '', color: 'gray' }
  const left = ttlMs - (nowMs - lastMs)
  if (left <= 0) return { text: 'cold', color: 'red' }
  const m = Math.ceil(left / 60_000)
  return { text: `warm ${m}m`, color: left < 5 * 60_000 ? 'red' : left < 15 * 60_000 ? 'yellow' : 'green' }
}
let lastToolMs = 0
let lastActiveMs = 0
let turnStartMs = 0
let endStartMs: number | undefined
let happyUntilMs = 0
let poll: Timer | null = null
let anim: Timer | null = null

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'deck', description: 'Show or hide the usage deck above the prompt' })
    poll?.cancel()
    anim?.cancel()
    // A reload resets these; without this Clawd thinks you've been idle forever and dozes.
    lastActiveMs = lastToolMs = await $.clock.now()
    poll = $.clock.every(60_000, () => refresh($))
    // Redraw at 12 fps, the claude.dev / Claude Code app clip rate; each clip holds its own frames at its fps.
    anim = $.clock.every(1000 / 12, () => update($, frame, f => (f + 1) % 100_000))
    await refresh($)
    return r
  })

  on('tool.call', async ($, e, next) => {
    lastToolMs = await $.clock.now()
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    lastActiveMs = lastToolMs = turnStartMs = await $.clock.now()
    await update($, isWorking, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    cachePct = cacheHit(e.usage) ?? cachePct
    lastCallMs = await $.clock.now()
    await update($, isWorking, () => false)
    const now = await $.clock.now()
    lastActiveMs = now
    endStartMs = now
    happyUntilMs = now + clipMs('typing-end') + 3_000
    await refresh($)
    return r
  })

  on('command.run', { name: 'deck' }, async $ => {
    const hidden = await read($, isHidden)
    await update($, isHidden, () => !hidden)
    return { text: hidden ? 'usage-deck: shown' : 'usage-deck: hidden (/deck shows it again)' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const ms = await read($, meters)
    if (e.props.hasSurvey || ms.length === 0 || (await read($, isHidden))) return below
    // Another plugin draws in the band: give it the rows, keeping at most the one-row deck.
    const crowded = !isEmpty(below)
    if (crowded && e.props.maxRows < CROWDED_MIN_ROWS) return below

    const { Box, Text } = $.ui.resolve(e)
    await read($, frame) // the 12 fps tick re-runs this hook; the frame itself comes from the clock
    const working = e.props.isWorking || (await read($, isWorking))
    const cols = Math.max(40, e.props.bodyColumns)
    const order = [...ms.filter(m => m.label !== 'CTX'), ...ms.filter(m => m.label === 'CTX')].slice(0, 3)
    const name = (m: Meter) => (m.label === '5H' ? '5-HOUR' : m.label === '7D' ? 'WEEKLY' : m.label === 'CTX' ? 'CONTEXT' : m.label)
    const sub = (m: Meter) =>
      m.label === 'CTX'
        ? `${m.note.replace(' / ', ' of ')}${cachePct !== null ? ` · cache ${cachePct}%` : ''}`
        : m.note ? `resets in ${m.note}` : ''
    const pct = (m: Meter) => `${String(Math.round(m.percent)).padStart(2, '0')}%`

    const nowMs = await $.clock.now()
    const clipName = clipFor({ working, nowMs, lastToolMs, lastActiveMs, happyUntilMs, turnStartMs, endStartMs })
    const clip = CLIPS[clipName]
    const once = clipName === 'typing-start' ? turnStartMs : clipName === 'typing-end' ? endStartMs : undefined
    const fi = frameIndex(clipName, nowMs, once)

    // Compact: one row while the engine's spinner squeezes the band: the clip's eye row, so Clawd keeps a face.
    if (e.props.maxRows < 4 || crowded) {
      const w = Math.max(6, Math.floor((cols - 18) / order.length) - 12)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text>{segsOf(Text, clip.frames[fi][clip.face[fi]])}</Text>
            {order.map(m => {
              const b = bar(m.percent, w)
              return (
                <Text key={m.label}>
                  <Text dimColor>{`  ${m.label} `}</Text>
                  <Text color={colorOf(m.percent)}>{b.fill}</Text>
                  <Text dimColor>{b.rest}</Text>
                  <Text color={colorOf(m.percent)} bold>{` ${pct(m)}`}</Text>
                </Text>
              )
            })}
          </Box>
          {below}
        </Box>
      )
    }

    // Full: Clawd on the left (a space, 16 cells, a gap so props never touch the meters), three columns.
    const rows = clip.frames[fi].slice(-Math.max(3, e.props.maxRows))
    const colW = Math.min(44, Math.floor((cols - 18) / order.length))
    const barW = Math.max(8, Math.min(28, colW - 9))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Box flexDirection="column" width={18}>
            {rows.map((segs, i) => (
              <Text key={`c${i}`}>
                {' '}
                {segsOf(Text, segs)}
              </Text>
            ))}
          </Box>
          {order.map(m => {
            const b = bar(m.percent, barW)
            const col = colorOf(m.percent)
            return (
              <Box key={m.label} flexDirection="column" width={colW}>
                <Text>
                  <Text dimColor bold>{name(m)}</Text>
                </Text>
                <Text>
                  <Text color={col}>{b.fill}</Text>
                  <Text dimColor>{b.rest}</Text>
                  <Text color={col} bold>{` ${pct(m).padStart(4)}`}</Text>
                </Text>
                <Text>
                  <Text dimColor>{sub(m)}</Text>
                  {m.label === 'CTX' && cacheLeft(nowMs, lastCallMs).text ? (
                    <Text color={cacheLeft(nowMs, lastCallMs).color}>{`  ${cacheLeft(nowMs, lastCallMs).text}`}</Text>
                  ) : null}
                </Text>
              </Box>
            )
          })}
        </Box>
        {below}
      </Box>
    )
  })
}
