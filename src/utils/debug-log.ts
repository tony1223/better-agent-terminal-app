/**
 * Debug logger - stores in MMKV for retrieval
 *
 * Usage:
 *   import { dlog } from '@/utils/debug-log'
 *   dlog('tag', 'message', optionalData)
 *
 * Retrieve: Settings screen → "Copy Debug Logs"
 */

import { createMMKV } from 'react-native-mmkv'

const storage = createMMKV({ id: 'bat-debug-log' })
const LOG_KEY = 'debug-log'
const MAX_SIZE = 50000 // keep ~50KB of logs

function ts(): string {
  return new Date().toISOString()
}

export function dlog(tag: string, message: string, data?: unknown): void {
  const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : ''
  const line = `${ts()} [${tag}] ${message}${dataStr}\n`

  try {
    const existing = storage.getString(LOG_KEY) ?? ''
    // Trim old logs if too large
    const trimmed = existing.length > MAX_SIZE
      ? existing.slice(existing.length - MAX_SIZE)
      : existing
    storage.set(LOG_KEY, trimmed + line)
  } catch {
    // fallback: overwrite
    storage.set(LOG_KEY, line)
  }

  // Also print to Metro console
  console.log(`[BAT] ${line.trim()}`)
}

/** Get all logs as a single string */
export function getDebugLogText(): string {
  return storage.getString(LOG_KEY) ?? '(no logs)'
}

/** Clear all logs */
export function clearDebugLogs(): void {
  storage.set(LOG_KEY, '')
}
