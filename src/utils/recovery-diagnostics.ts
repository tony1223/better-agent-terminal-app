import { createMMKV } from 'react-native-mmkv'
import { createBufferedLog } from './buffered-log'

const storage = createMMKV({ id: 'bat-recovery-diagnostics' })
const KEY = 'events'
const MAX_CHARS = 256 * 1024
const log = createBufferedLog(storage, KEY, MAX_CHARS)
export const diagnosticRunId = Date.now().toString(36)
const run = diagnosticRunId
let sequence = 0
type Fields = Record<string, string | number | boolean | null | undefined>

/** Always-on timings only. Never pass request bodies, messages or credentials. */
export function recoveryEvent(event: string, fields: Fields = {}): void {
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), run, event, ...fields }) + '\n'
    log.append(line, fields.outcome === 'error' || event.includes('error') ||
      (event === 'app.state' && fields.state !== 'active'))
  } catch { /* Diagnostics must never interrupt connection recovery. */ }
}

export function recoverySpan(event: string, fields: Fields = {}) {
  const id = ++sequence
  const started = Date.now()
  recoveryEvent(`${event}.start`, { ...fields, span: id })
  let finished = false
  return (outcome: string, details: Fields = {}) => {
    if (finished) return
    finished = true
    recoveryEvent(`${event}.end`, { ...fields, ...details, span: id, outcome, elapsedMs: Date.now() - started })
  }
}

export const getRecoveryDiagnostics = log.read
export const clearRecoveryDiagnostics = log.clear
export const flushRecoveryDiagnostics = log.flush
