/**
 * Debug logger - stores in MMKV for retrieval
 *
 * Usage:
 *   import { dlog } from '@/utils/debug-log'
 *   dlog('tag', 'message', optionalData)
 *
 * Toggle: Settings screen → Debug Mode switch
 * Retrieve: Settings screen → "Share Debug Logs" / "View Logs"
 */

import { createMMKV } from 'react-native-mmkv'
import { createBufferedLog } from './buffered-log'

const storage = createMMKV({ id: 'bat-debug-log' })
const LOG_KEY = 'debug-log'
const DEBUG_MODE_KEY = 'debug-mode'
const MAX_SIZE = 100000 // ~100KB rolling buffer
const log = createBufferedLog(storage, LOG_KEY, MAX_SIZE)

function ts(): string {
  return new Date().toISOString()
}

/** Check if debug mode is enabled */
export function isDebugMode(): boolean {
  return storage.getBoolean(DEBUG_MODE_KEY) ?? false
}

/** Toggle debug mode on/off */
export function setDebugMode(enabled: boolean): void {
  storage.set(DEBUG_MODE_KEY, enabled)
}

/**
 * Write a debug log entry.
 * - Always logs errors (tag starts with '!' or level='error')
 * - Other logs only written when debug mode is on
 */
export function dlog(tag: string, message: string, data?: unknown): void {
  const isError = tag.startsWith('!')
  if (!isError && !isDebugMode()) return

  const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : ''
  const line = `${ts()} [${tag}] ${message}${dataStr}\n`

  log.append(line, isError)

  // Also print to Metro/logcat console
  if (isError) {
    console.warn(`[BAT] ${line.trim()}`)
  } else if (__DEV__) {
    console.log(`[BAT] ${line.trim()}`)
  }
}

/** Get all logs as a single string */
export function getDebugLogText(): string {
  return log.read() || '(no logs)'
}

/** Clear all logs */
export function clearDebugLogs(): void {
  log.clear()
}

export const flushDebugLogs = log.flush
