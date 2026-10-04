import { NativeModules } from 'react-native'
import { captureRuntimeDiagnostics, getLastRuntimeDiagnostics } from '../src/native/runtime-diagnostics'
import { clearIncidentDiagnostics, getIncidentDiagnostics } from '../src/utils/incident-diagnostics'

jest.mock('react-native', () => ({ NativeModules: { AppInfo: { getRuntimeDiagnostics: jest.fn(), version: '1.0.test', build: '1' } } }))
jest.mock('../src/utils/recovery-diagnostics', () => ({ recoveryEvent: jest.fn() }))
const read = NativeModules.AppInfo.getRuntimeDiagnostics as jest.Mock
const sample = { atMs: 1000, pid: 12, cpuTimeMs: 25, elapsedRealtimeMs: 5000, uptimeMs: 4900,
  javaHeapUsedBytes: 100, javaHeapLimitBytes: 500, nativeHeapBytes: 200, interactive: true,
  exits: [{ atMs: 500, pid: 11, reason: 6, reasonLabel: 'anr', status: 0, importance: 100, pssKb: 50, rssKb: 80 }] }
beforeEach(() => { jest.useFakeTimers(); read.mockReset(); clearIncidentDiagnostics() })
afterEach(() => jest.useRealTimers())

test('startup/export keeps native process facts and own-app exit records with their App version', async () => {
  read.mockResolvedValue(sample)
  expect(await captureRuntimeDiagnostics('export', true)).toEqual(sample)
  expect(read).toHaveBeenCalledWith(true)
  expect(JSON.parse(getIncidentDiagnostics())).toMatchObject({ event: 'process.snapshot', appVersion: '1.0.test (1)', ...sample })
  expect(getLastRuntimeDiagnostics()).toEqual(sample)
  expect(jest.getTimerCount()).toBe(0)
})

test('cheap periodic samples do not request exit history or persist incident records', async () => {
  read.mockResolvedValue({ ...sample, exits: undefined })
  await captureRuntimeDiagnostics('interval')
  expect(read).toHaveBeenCalledWith(false)
  expect(getIncidentDiagnostics()).toBe('')
})

test('an unavailable or stuck native module cannot block uploading other logs', async () => {
  read.mockRejectedValueOnce(new Error('unavailable'))
  expect(await captureRuntimeDiagnostics('export', true)).toBeNull()
  read.mockReturnValue(new Promise(() => {}))
  const pending = captureRuntimeDiagnostics('export', true)
  await jest.advanceTimersByTimeAsync(2000)
  expect(await pending).toBeNull()
  expect(jest.getTimerCount()).toBe(0)
})

test('a late native response cannot replace a newer snapshot', async () => {
  let finish!: (value: unknown) => void
  read.mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValueOnce({ ...sample, atMs: 3000 })
  const old = captureRuntimeDiagnostics('active')
  await captureRuntimeDiagnostics('interval')
  finish({ ...sample, atMs: 2000 })
  await old
  expect(getLastRuntimeDiagnostics()?.atMs).toBe(3000)
})

test('large process snapshots survive log rollover without writing every sample', async () => {
  const large = { ...sample, pid: 900, atMs: 10_000, rssKb: 900 * 1024,
    threadCpuTop: [{ tid: 901, kind: 'javascript', cpuMs: 6000 }], threadSampleWindowMs: 30_000 }
  read.mockResolvedValue(large)
  await captureRuntimeDiagnostics('interval')
  read.mockResolvedValue({ ...large, atMs: 40_000 })
  await captureRuntimeDiagnostics('interval')
  const entries = getIncidentDiagnostics().trim().split('\n').map(line => JSON.parse(line))
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ event: 'performance.high-memory', rssKb: large.rssKb, threadCpuTop: large.threadCpuTop })
})
