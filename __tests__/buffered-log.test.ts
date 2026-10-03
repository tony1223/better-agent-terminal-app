import { createBufferedLog } from '../src/utils/buffered-log'

beforeEach(() => { jest.useFakeTimers() })
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers() })

test('a burst of 500 events needs one storage write and exports include pending events', () => {
  const storage = { getString: jest.fn(() => 'previous\n'), set: jest.fn() }
  const log = createBufferedLog(storage, 'events', 100_000)
  for (let i = 0; i < 500; i++) log.append(`${i}\n`)
  expect(storage.getString).toHaveBeenCalledTimes(1)
  expect(storage.set).not.toHaveBeenCalled()
  expect(log.read()).toMatch(/^previous\n0\n/)
  expect(log.read()).toMatch(/499\n$/)
  jest.advanceTimersByTime(1000)
  expect(storage.set).toHaveBeenCalledTimes(1)
  expect(storage.set).toHaveBeenCalledWith('events', log.read())
  jest.advanceTimersByTime(60_000)
  expect(storage.set).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
})

test('critical errors and background flush persist all preceding pending events immediately', () => {
  const storage = { getString: jest.fn(), set: jest.fn() }
  const log = createBufferedLog(storage, 'events', 1000)
  log.append('start\n')
  log.append('error\n', true)
  expect(storage.set).toHaveBeenLastCalledWith('events', 'start\nerror\n')
  log.append('background\n')
  log.flush()
  expect(storage.set).toHaveBeenLastCalledWith('events', 'start\nerror\nbackground\n')
  expect(jest.getTimerCount()).toBe(0)
})

test('clear cancels pending writes and cannot resurrect old logs', () => {
  const storage = { getString: jest.fn(() => 'old\n'), set: jest.fn() }
  const log = createBufferedLog(storage, 'events', 1000)
  log.append('new\n')
  log.clear()
  jest.advanceTimersByTime(10_000)
  expect(log.read()).toBe('')
  expect(storage.set).toHaveBeenCalledTimes(1)
  expect(storage.set).toHaveBeenCalledWith('events', '')
})

test('bounded JSONL tail contains only complete events, including before a flush', () => {
  const storage = { getString: jest.fn(), set: jest.fn() }
  const log = createBufferedLog(storage, 'events', 100)
  for (let i = 0; i < 100; i++) log.append(JSON.stringify({ i }) + '\n')
  expect(log.read().length).toBeLessThanOrEqual(100)
  const entries = log.read().trim().split('\n').map(line => JSON.parse(line))
  expect(entries.at(-1)).toEqual({ i: 99 })
  expect(entries[0].i).toBeGreaterThan(0)
})

test('failed storage writes retain the tail and retry on the next flush', () => {
  const storage = { getString: jest.fn(), set: jest.fn().mockImplementationOnce(() => { throw new Error('disk') }) }
  const log = createBufferedLog(storage, 'events', 1000)
  log.append('first\n', true)
  log.append('second\n')
  jest.advanceTimersByTime(1000)
  expect(storage.set).toHaveBeenLastCalledWith('events', 'first\nsecond\n')
})
