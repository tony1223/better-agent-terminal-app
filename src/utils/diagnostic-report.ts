import { Platform } from 'react-native'
import { fromByteArray } from 'base64-js'
import { createFsChannel } from '@/api/channels/fs'
import { useConnectionStore } from '@/stores/connection-store'
import { appVersionLabel } from '@/native/app-info'
import { getDebugLogText } from './debug-log'
import { getRecoveryDiagnostics } from './recovery-diagnostics'
import { flushPerformanceDiagnostics } from './performance-diagnostics'
import { getIncidentDiagnostics } from './incident-diagnostics'
import { captureRuntimeDiagnostics } from '@/native/runtime-diagnostics'

export function redactDiagnosticText(text: string): string {
  return text
    .replace(/("(?:token|password|secret|api[_-]?key)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[redacted]"')
    .replace(/(\b(?:token|password|secret|api[_-]?key)\s*[=:]\s*)[^\s,;)]+/gi, '$1[redacted]')
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[redacted]')
    .replace(/(\b(?:wss?|https?):\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
}

export function getDiagnosticLogText(): string {
  flushPerformanceDiagnostics('export')
  return `Performance incidents\n${getIncidentDiagnostics()}\nRecovery timings\n${getRecoveryDiagnostics()}\nDebug logs\n${redactDiagnosticText(getDebugLogText())}`
}

/** Use the entry host, even when a remote profile is selected or unavailable. */
export async function uploadDiagnosticReport(): Promise<string> {
  const state = useConnectionStore.getState()
  const client = state.client
  if (!client || state.status !== 'connected') throw new Error('Not connected to host')
  const createdAt = new Date().toISOString()
  flushPerformanceDiagnostics('export')
  const runtimeDiagnostics = await captureRuntimeDiagnostics('export', true)
  if (useConnectionStore.getState().client !== client) throw new Error('Connection changed during upload')
  const report = JSON.stringify({
    schemaVersion: 1,
    createdAt,
    appVersion: appVersionLabel,
    platform: Platform.OS,
    platformVersion: Platform.Version,
    hostVersion: client.serverVersion,
    runtimeDiagnostics,
    performanceIncidents: getIncidentDiagnostics(),
    connection: { status: state.status, tls: state.tls, profileStatus: state.profileStatus,
      selectedProfileId: state.selectedProfileId, supportsMobileSync: client.supportsMobileSync },
    recoveryEvents: getRecoveryDiagnostics(),
    debugLog: redactDiagnosticText(getDebugLogText()),
  }, null, 2)
  // Encode UTF-8 explicitly; Hermes does not provide the browser btoa global.
  const bytes = encodeURIComponent(report).replace(/%([0-9A-F]{2})/g,
    (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  const path = await createFsChannel(client).uploadToHostTmp(
    `bat-mobile-diagnostics-${createdAt.replace(/[:.]/g, '-')}.json`,
    fromByteArray(Uint8Array.from(bytes, char => char.charCodeAt(0))),
  )
  if (useConnectionStore.getState().client !== client) throw new Error('Connection changed during upload')
  return path
}
