import { createMMKV } from 'react-native-mmkv'

const storage = createMMKV({ id: 'bat-recovery-diagnostics' })
const KEY = 'events'
const MAX_CHARS = 256 * 1024
const run = Date.now().toString(36)
let sequence = 0
type Fields = Record<string, string | number | boolean | null | undefined>

/** Always-on timings only. Never pass request bodies, messages or credentials. */
export function recoveryEvent(event: string, fields: Fields = {}): void {
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), run, event, ...fields }) + '\n'
    let text = (storage.getString(KEY) ?? '') + line
    if (text.length > MAX_CHARS) {
      text = text.slice(-MAX_CHARS)
      text = text.slice(text.indexOf('\n') + 1)
    }
    storage.set(KEY, text)
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

export const getRecoveryDiagnostics = () => storage.getString(KEY) ?? ''
export const clearRecoveryDiagnostics = () => storage.set(KEY, '')
