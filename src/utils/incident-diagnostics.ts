import { createMMKV } from 'react-native-mmkv'
import { appVersionLabel } from '@/native/app-info'
import { createBufferedLog } from './buffered-log'
import { diagnosticRunId } from './recovery-diagnostics'

// A separate bounded tail survives the high-volume RPC log rolling over.
const log = createBufferedLog(createMMKV({ id: 'bat-performance-incidents' }), 'events', 64 * 1024)
export function recordIncident(event: string, fields: Record<string, unknown>): void {
  try {
    log.append(JSON.stringify({ at: new Date().toISOString(), run: diagnosticRunId, appVersion: appVersionLabel, event, ...fields }) + '\n', true)
  } catch { /* Diagnostics must not interrupt recovery or upload. */ }
}
export const getIncidentDiagnostics = log.read
export const clearIncidentDiagnostics = log.clear
