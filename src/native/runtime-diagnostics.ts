import { NativeModules } from 'react-native'
import { recoveryEvent } from '@/utils/recovery-diagnostics'
import { recordIncident } from '@/utils/incident-diagnostics'

export interface RuntimeDiagnostics {
  atMs: number
  pid: number
  elapsedRealtimeMs: number
  uptimeMs: number
  cpuTimeMs: number
  javaHeapUsedBytes: number
  javaHeapLimitBytes: number
  nativeHeapBytes: number
  interactive: boolean
  thermalStatus?: number
  pssKb?: number
  rssKb?: number
  threadCpuTop?: Array<{ tid: number; kind: string; cpuMs: number }>
  threadSampleWindowMs?: number
  threadsSampled?: number
  threadsTruncated?: boolean
  processCountersReadMs?: number
  exitHistorySupported?: boolean
  exits?: Array<{ atMs: number; pid: number; reason: number; reasonLabel: string; status: number; importance: number; pssKb: number; rssKb: number }>
}
let last: RuntimeDiagnostics | null = null
let lastMemoryIncident: { pid: number; atMs: number } | null = null
export const getLastRuntimeDiagnostics = () => last

/** Optional on older binaries/iOS, bounded so diagnostic upload cannot hang. */
export async function captureRuntimeDiagnostics(reason: string, includeExitHistory = false): Promise<RuntimeDiagnostics | null> {
  const native = NativeModules.AppInfo
  if (typeof native?.getRuntimeDiagnostics !== 'function') return null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race<RuntimeDiagnostics>([
      native.getRuntimeDiagnostics(includeExitHistory),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 2000) }),
    ])
    if (!result || !Number.isFinite(result.pid) || !Number.isFinite(result.cpuTimeMs)) throw new Error('invalid response')
    if (!last || result.atMs >= last.atMs) last = result
    const { exits, ...snapshot } = result
    recoveryEvent('performance.native', { reason, ...snapshot })
    // Preserve evidence before a large process is killed and the rolling log
    // is lost. These are diagnostic thresholds, not an OOM/leak diagnosis.
    if ((result.rssKb ?? 0) >= 768 * 1024 || result.nativeHeapBytes >= 512 * 1024 * 1024) {
      if (!lastMemoryIncident || lastMemoryIncident.pid !== result.pid || result.atMs - lastMemoryIncident.atMs >= 300_000) {
        recordIncident('performance.high-memory', { reason, ...snapshot })
        lastMemoryIncident = { pid: result.pid, atMs: result.atMs }
      }
    }
    if (includeExitHistory) recordIncident('process.snapshot', { reason, ...snapshot, exits })
    return result
  } catch {
    recoveryEvent('performance.native-unavailable', { reason })
    return null
  } finally { if (timer !== undefined) clearTimeout(timer) }
}
