import { AppState } from 'react-native'
import { recoveryEvent } from './recovery-diagnostics'
import { captureRuntimeDiagnostics, getLastRuntimeDiagnostics } from '@/native/runtime-diagnostics'
import { recordIncident } from './incident-diagnostics'

type Metric = 'stream-dispatch' | 'stream-view' | 'markdown-parse'
type Sample = { metric: Metric; foreground: boolean; count: number; chars: number; maxChars: number; totalMs: number; maxMs: number }
const samples = new Map<string, Sample>()
let startedAt = 0
let timer: ReturnType<typeof setTimeout> | undefined
let dueAt = 0
let collecting = false
let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive'

// Hermes supplies a monotonic clock; retain a millisecond fallback for other runtimes.
export const performanceNow = () => (globalThis as unknown as { performance?: { now(): number } }).performance?.now() ?? Date.now()

/** Numeric work counters only: no content, paths, credentials or per-token I/O. */
export function recordPerformance(metric: Metric, chars: number, elapsedMs = 0): void {
  if (!collecting) return
  if (!samples.size) startedAt = Date.now()
  const key = `${metric}:${foreground}`
  const sample = samples.get(key) ?? { metric, foreground, count: 0, chars: 0, maxChars: 0, totalMs: 0, maxMs: 0 }
  sample.count++
  sample.chars += chars
  sample.maxChars = Math.max(sample.maxChars, chars)
  sample.totalMs += elapsedMs
  sample.maxMs = Math.max(sample.maxMs, elapsedMs)
  samples.set(key, sample)
  if (foreground && timer === undefined) {
    dueAt = Date.now() + 30_000
    timer = setTimeout(() => flushPerformanceDiagnostics('interval'), 30_000)
  }
}

export function flushPerformanceDiagnostics(reason: string): void {
  const lateMs = reason === 'interval' && dueAt ? Math.max(0, Date.now() - dueAt) : 0
  const before = getLastRuntimeDiagnostics()
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  dueAt = 0
  if (lateMs > 5000) {
    // This records lateness, not an ANR diagnosis: suspension/clock changes can also delay JS.
    recordIncident('performance.late-timer', { lateMs, foreground, before })
    captureRuntimeDiagnostics('late-timer').then(after => {
      recordIncident('performance.late-timer-sample', { lateMs, before, after })
    })
  } else if (samples.size && reason === 'interval') {
    captureRuntimeDiagnostics(reason)
  }
  for (const sample of samples.values()) recoveryEvent('performance.window', {
    ...sample, reason, windowMs: Date.now() - startedAt,
    totalMs: Math.round(sample.totalMs * 100) / 100,
    maxMs: Math.round(sample.maxMs * 100) / 100,
  })
  samples.clear()
}

export function subscribePerformanceDiagnostics(): () => void {
  collecting = true
  foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive'
  captureRuntimeDiagnostics('startup', true)
  const subscription = AppState.addEventListener('change', state => {
    flushPerformanceDiagnostics(state === 'active' ? 'foreground' : 'background')
    foreground = state === 'active'
    captureRuntimeDiagnostics(state)
  })
  return () => { collecting = false; subscription.remove(); flushPerformanceDiagnostics('unmount') }
}
