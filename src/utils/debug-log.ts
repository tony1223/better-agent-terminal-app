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

const storage = createMMKV({ id: 'bat-debug-log' })
const LOG_KEY = 'debug-log'
const DEBUG_MODE_KEY = 'debug-mode'
const MAX_SIZE = 100000 // ~100KB rolling buffer

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

  try {
    const existing = storage.getString(LOG_KEY) ?? ''
    const trimmed = existing.length > MAX_SIZE
      ? existing.slice(existing.length - MAX_SIZE)
      : existing
    storage.set(LOG_KEY, trimmed + line)
  } catch {
    storage.set(LOG_KEY, line)
  }

  // Also print to Metro/logcat console
  if (isError) {
    console.warn(`[BAT] ${line.trim()}`)
  } else {
    console.log(`[BAT] ${line.trim()}`)
  }
}

/** Get all logs as a single string */
export function getDebugLogText(): string {
  return storage.getString(LOG_KEY) ?? '(no logs)'
}

/** Clear all logs */
export function clearDebugLogs(): void {
  storage.set(LOG_KEY, '')
}
