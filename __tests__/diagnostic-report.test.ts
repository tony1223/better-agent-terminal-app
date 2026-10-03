import { uploadDiagnosticReport, redactDiagnosticText } from '../src/utils/diagnostic-report'
import { Buffer } from 'buffer'
import { useConnectionStore } from '../src/stores/connection-store'
import { recoveryEvent, recoverySpan, getRecoveryDiagnostics, clearRecoveryDiagnostics } from '../src/utils/recovery-diagnostics'
import { recordPerformance, subscribePerformanceDiagnostics } from '../src/utils/performance-diagnostics'

jest.mock('@/stores/connection-store', () => ({ useConnectionStore: { getState: jest.fn() } }))
jest.mock('@/native/app-info', () => ({ appVersionLabel: '1.0.test (1)' }))
jest.mock('@/utils/debug-log', () => ({
  getDebugLogText: () => '重連測試 📱 token=private-token Bearer abc.def "password":"hidden"',
}))

const getState = useConnectionStore.getState as jest.Mock
let state: any
let payload: string
let totalBytes: number

beforeEach(() => {
  clearRecoveryDiagnostics()
  payload = ''
  totalBytes = 0
  state = {
    status: 'connected', tls: true, profileStatus: 'unavailable', selectedProfileId: 'remote',
    channels: { fs: { uploadToHostTmp: jest.fn(() => { throw new Error('wrong host') }) } },
    client: { serverVersion: '3.2.14', supportsMobileSync: true, invokeParams: jest.fn(async (channel, params) => {
      if (channel === 'fs:upload-tmp-begin') { totalBytes = params.totalBytes; return { uploadId: 'upload-1' } }
      if (channel === 'fs:upload-tmp-chunk') { payload += params.dataBase64; return { received: totalBytes } }
      if (channel === 'fs:upload-tmp-end') return { path: '/tmp/bat-remote-uploads/diagnostic.json' }
      return true
    }) },
  }
  getState.mockImplementation(() => state)
})

it('uploads UTF-8 diagnostics to the entry host even if the selected profile is unavailable', async () => {
  recoveryEvent('socket.resume', { status: 'connected' })
  expect(state.client.invokeParams).not.toHaveBeenCalled()
  await expect(uploadDiagnosticReport()).resolves.toBe('/tmp/bat-remote-uploads/diagnostic.json')
  const decoded = Buffer.from(payload, 'base64')
  expect(decoded.length).toBe(totalBytes)
  const report = JSON.parse(decoded.toString('utf8'))
  expect(report).toMatchObject({ appVersion: '1.0.test (1)', hostVersion: '3.2.14', connection: { profileStatus: 'unavailable' } })
  expect(report.debugLog).toContain('重連測試 📱')
  expect(report.debugLog).not.toMatch(/private-token|abc.def|hidden/)
  expect(report.recoveryEvents).toContain('socket.resume')
  expect(state.channels.fs.uploadToHostTmp).not.toHaveBeenCalled()
})

it('does not start uploading while disconnected', async () => {
  state.status = 'reconnecting'
  await expect(uploadDiagnosticReport()).rejects.toThrow('Not connected')
  expect(state.client.invokeParams).not.toHaveBeenCalled()
})

it('upload includes performance counters immediately, without waiting for their batch timer', async () => {
  const stop = subscribePerformanceDiagnostics()
  try {
    recordPerformance('markdown-parse', 1200, 8.25)
    await uploadDiagnosticReport()
    const report = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
    const events = report.recoveryEvents.trim().split('\n').map((line: string) => JSON.parse(line))
    expect(events).toContainEqual(expect.objectContaining({ event: 'performance.window',
      metric: 'markdown-parse', chars: 1200, count: 1, totalMs: 8.25, reason: 'export' }))
  } finally { stop() }
})

it('aborts the partial upload on a failed chunk', async () => {
  const invoke = state.client.invokeParams
  invoke.mockImplementation(async (channel: string) => {
    if (channel.endsWith('begin')) return { uploadId: 'upload-1' }
    if (channel.endsWith('chunk')) throw new Error('network failure')
    return true
  })
  await expect(uploadDiagnosticReport()).rejects.toThrow('network failure')
  expect(invoke).toHaveBeenLastCalledWith('fs:upload-tmp-abort', { uploadId: 'upload-1' }, ['upload-1'])
})

it('does not report a successful upload as belonging to a newly selected host', async () => {
  const client = state.client
  client.invokeParams.mockImplementation(async (channel: string) => {
    if (channel.endsWith('begin')) return { uploadId: 'upload-1' }
    if (channel.endsWith('end')) { state = { ...state, client: {} }; return { path: '/tmp/old-host.json' } }
    return { received: 1 }
  })
  await expect(uploadDiagnosticReport()).rejects.toThrow('Connection changed')
})

it('redacts credential formats retained by older debug logs', () => {
  const text = 'token=abc..., password=hunter2 api_key=secret123 https://user:pass@host/path "token":"json-token"'
  const redacted = redactDiagnosticText(text)
  expect(redacted).not.toMatch(/abc|hunter2|secret123|user:pass|json-token/)
  expect(redacted).toContain('host/path')
})

it('retains complete JSONL events within the rolling limit', () => {
  for (let i = 0; i < 500; i++) recoveryEvent('test', { index: i, padding: 'x'.repeat(1000) })
  const text = getRecoveryDiagnostics()
  expect(text.length).toBeLessThanOrEqual(256 * 1024)
  const events = text.trim().split('\n').map(line => JSON.parse(line))
  expect(events[0].index).toBeGreaterThan(0)
  expect(events.at(-1).index).toBe(499)
  clearRecoveryDiagnostics()
  expect(getRecoveryDiagnostics()).toBe('')
})

it('records elapsed time once, even when both error and close callbacks fire', () => {
  jest.useFakeTimers()
  try {
    const finish = recoverySpan('socket.connect')
    jest.advanceTimersByTime(5100)
    finish('error')
    finish('closed')
    const events = getRecoveryDiagnostics().trim().split('\n').map(line => JSON.parse(line))
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ event: 'socket.connect.end', outcome: 'error', elapsedMs: 5100, span: events[0].span })
  } finally { jest.useRealTimers() }
})
