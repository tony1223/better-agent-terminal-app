import { AppState } from 'react-native'
import { recordPerformance, flushPerformanceDiagnostics, subscribePerformanceDiagnostics } from '../src/utils/performance-diagnostics'
import { recoveryEvent } from '../src/utils/recovery-diagnostics'
import { clearIncidentDiagnostics, getIncidentDiagnostics } from '../src/utils/incident-diagnostics'

jest.mock('../src/utils/recovery-diagnostics', () => ({ recoveryEvent: jest.fn() }))
let stop: () => void
let change: (state: string) => void
beforeEach(() => {
  jest.useFakeTimers()
  clearIncidentDiagnostics()
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    change = callback as typeof change
    return { remove: jest.fn() }
  })
  stop = subscribePerformanceDiagnostics()
  ;(recoveryEvent as jest.Mock).mockClear()
})
afterEach(() => { stop(); jest.useRealTimers(); jest.restoreAllMocks() })

test('1000 stream chunks make one numeric summary with no per-chunk log writes', () => {
  for (let i = 0; i < 1000; i++) recordPerformance('stream-dispatch', 8, 0.5)
  expect(recoveryEvent).not.toHaveBeenCalled()
  expect(jest.getTimerCount()).toBe(1)
  jest.advanceTimersByTime(30_000)
  expect(recoveryEvent).toHaveBeenCalledTimes(1)
  expect(recoveryEvent).toHaveBeenCalledWith('performance.window', expect.objectContaining({
    metric: 'stream-dispatch', count: 1000, chars: 8000, maxChars: 8, totalMs: 500, maxMs: 0.5, foreground: true,
  }))
  expect(jest.getTimerCount()).toBe(0)
})

test('background cancels timers, groups background work separately, and export flushes pending totals', () => {
  recordPerformance('markdown-parse', 100, 12)
  change('background')
  expect(jest.getTimerCount()).toBe(0)
  recordPerformance('stream-dispatch', 30, 0.1)
  expect(jest.getTimerCount()).toBe(0)
  change('active')
  expect(recoveryEvent).toHaveBeenLastCalledWith('performance.window', expect.objectContaining({ metric: 'stream-dispatch', foreground: false }))
  recordPerformance('stream-view', 200)
  flushPerformanceDiagnostics('export')
  expect(recoveryEvent).toHaveBeenLastCalledWith('performance.window', expect.objectContaining({ metric: 'stream-view', reason: 'export', chars: 200 }))
  expect(jest.getTimerCount()).toBe(0)
})

test('a delayed foreground timer leaves a separate durable incident, without claiming an ANR', async () => {
  recordPerformance('stream-dispatch', 5, 1)
  jest.setSystemTime(Date.now() + 90_000)
  flushPerformanceDiagnostics('interval')
  await Promise.resolve()
  const incidents = getIncidentDiagnostics().trim().split('\n').map(line => JSON.parse(line))
  expect(incidents[0]).toMatchObject({ event: 'performance.late-timer', lateMs: 60_000, foreground: true })
  expect(incidents[0].appVersion).toBeTruthy()
  expect(incidents[1]).toMatchObject({ event: 'performance.late-timer-sample', after: null })
  expect(jest.getTimerCount()).toBe(0)
})
