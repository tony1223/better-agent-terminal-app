/**
 * WorkerScreen - a Procfile panel: its processes, and their merged log.
 *
 * Nothing runs under this panel's own id, so this is not a TerminalScreen with
 * the keyboard removed — attaching a PTY here would spawn a shell the host never
 * meant to exist. The log is the host's shared per-panel buffer (what the
 * desktop window shows) replayed on attach, then the live `pty:output` /
 * `pty:exit` events of the panel's processes, each line prefixed with the
 * process name in its colour, exactly as the desktop paints it.
 *
 * Process output is persisted by the host; this client appends only the banner
 * lines it authors (header, exit, restarting), as a remote desktop window does.
 * It never auto-starts anything and never stops anything on leaving: the
 * processes belong to the host, and a phone glancing at them is not a reason
 * to change them.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { WebView } from 'react-native-webview'
import type { WebViewMessageEvent } from 'react-native-webview'
import { useFocusEffect } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useConnectionStore } from '@/stores/connection-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useWorkerStore } from '@/stores/worker-store'
import { appColors, fontSize, spacing } from '@/theme/colors'
import { terminalHtml } from '@/components/terminal/terminal-html'
import { SessionContextBar } from '@/components/session/SessionContextBar'
import { SessionWorkspaceTabs } from '@/components/session/SessionWorkspaceTabs'
import { dlog } from '@/utils/debug-log'
import {
  WORKER_HEADER_NAME,
  buildWorkerHeader,
  parseWorkerBuffer,
  prefixWorkerChunk,
  serializeWorkerEntries,
  splitWorkerPtyId,
  workerLinePrefix,
  type WorkerLogEntry,
  type WorkerProcess,
  type WorkerProcessStatus,
} from '@/utils/worker'

type Props = NativeStackScreenProps<any, 'Worker'>

const OUTPUT_FLUSH_MS = 16
/** Same debounce as the desktop's disk flush, so a burst of banners is one append. */
const BUFFER_APPEND_MS = 500
const FALLBACK_COLOR = '#888888'

const STATUS_COLOR: Record<WorkerProcessStatus, string> = {
  starting: '#e5c07b',
  running: '#98c379',
  stopped: appColors.textMuted,
  crashed: appColors.error,
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function WorkerScreen({ route, navigation }: Props) {
  const { t } = useTranslation()
  const terminalId = route.params?.terminalId as string
  const webViewRef = useRef<WebView>(null)
  const channels = useConnectionStore(s => s.channels)
  const terminal = useWorkspaceStore(s => s.terminals.find(item => item.id === terminalId))
  const loadStatus = useWorkspaceStore(s => s.loadStatus)
  const workspace = useWorkspaceStore(s => {
    const term = s.terminals.find(item => item.id === terminalId)
    return term ? s.workspaces.find(w => w.id === term.workspaceId) : undefined
  })
  const processes = useWorkerStore(s => s.panels[terminalId]?.processes)
  const rosterError = useWorkerStore(s => s.panels[terminalId]?.error ?? null)
  const procfilePath = terminal?.procfilePath
  const cwdFallback = terminal?.cwd || workspace?.folderPath || ''
  const [busyKeys, setBusyKeys] = useState<string[]>([])

  const terminalReadyRef = useRef(false)
  const attachedRef = useRef(false)
  const attachingRef = useRef(false)
  const focusedOnceRef = useRef(false)
  const processesRef = useRef<WorkerProcess[]>([])
  const midLineRef = useRef<Record<string, boolean>>({})
  const deferredRef = useRef<WorkerLogEntry[]>([])
  const outputBufferRef = useRef('')
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingAppendRef = useRef<WorkerLogEntry[]>([])
  const appendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    processesRef.current = processes ?? []
  }, [processes])

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerRight: () => (
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>{t('terminal.sessions')}</Text>
        </TouchableOpacity>
      ),
      headerTitle: () => (
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {workspace?.alias || workspace?.name || t('terminal.workspaceFallback')}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {terminal?.alias || terminal?.title || t('nav.worker')}
          </Text>
        </View>
      ),
      headerStyle: { backgroundColor: appColors.surface },
      headerTintColor: appColors.text,
    })
  }, [navigation, terminal, workspace, t])

  useEffect(() => {
    if ((loadStatus === 'ok' || loadStatus === 'empty') && !terminal) {
      navigation.goBack()
    }
  }, [loadStatus, navigation, terminal])

  // ---- Log rendering -------------------------------------------------------

  const flushOutput = useCallback(() => {
    flushTimerRef.current = null
    if (!outputBufferRef.current || !webViewRef.current) return
    const data = outputBufferRef.current
    outputBufferRef.current = ''
    webViewRef.current.injectJavaScript(`window.handleOutput(${JSON.stringify(data)}); true;`)
  }, [])

  const write = useCallback((data: string) => {
    outputBufferRef.current += data
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(flushOutput, OUTPUT_FLUSH_MS)
    }
  }, [flushOutput])

  const renderEntry = useCallback((entry: WorkerLogEntry) => {
    if (entry.name === WORKER_HEADER_NAME) {
      write(entry.data)
      return
    }
    const roster = processesRef.current
    // Host-written lines carry no colour; the roster supplies it by name, so a
    // process is painted the same whichever client wrote the line.
    const color = entry.color || roster.find(p => p.name === entry.name)?.color || FALLBACK_COLOR
    const nameWidth = Math.max(entry.name.length, ...roster.map(p => p.name.length))
    const formatted = prefixWorkerChunk(
      entry.data,
      workerLinePrefix(entry.name, color, nameWidth),
      !!midLineRef.current[entry.name],
    )
    midLineRef.current[entry.name] = formatted.midLine
    write(formatted.output)
  }, [write])

  const flushAppends = useCallback(() => {
    appendTimerRef.current = null
    const batch = pendingAppendRef.current
    pendingAppendRef.current = []
    if (batch.length === 0 || !channels) return
    channels.worker.bufferAppend(terminalId, serializeWorkerEntries(batch))
      .catch(e => dlog('WORKER', `buffer append failed panel=${terminalId}: ${errorText(e)}`))
  }, [channels, terminalId])

  const persist = useCallback((entry: WorkerLogEntry) => {
    pendingAppendRef.current.push(entry)
    if (!appendTimerRef.current) {
      appendTimerRef.current = setTimeout(flushAppends, BUFFER_APPEND_MS)
    }
  }, [flushAppends])

  /** Show a line now (or once the replay is in), and optionally add it to the shared log. */
  const emit = useCallback((entry: WorkerLogEntry, persistIt: boolean) => {
    if (persistIt) persist(entry)
    if (attachedRef.current) renderEntry(entry)
    else deferredRef.current.push(entry)
  }, [persist, renderEntry])

  const writeHeader = useCallback((count: number) => {
    if (!procfilePath) return
    const header = buildWorkerHeader(procfilePath, count)
    emit({ name: WORKER_HEADER_NAME, color: '', data: header }, true)
  }, [emit, procfilePath])

  const attach = useCallback(async () => {
    if (!channels || !procfilePath || !terminalReadyRef.current) return
    if (attachedRef.current || attachingRef.current) return
    attachingRef.current = true
    try {
      await channels.worker.bufferInit(terminalId).catch(e => {
        dlog('WORKER', `buffer init failed panel=${terminalId}: ${errorText(e)}`)
      })
      let roster: WorkerProcess[] = processesRef.current
      try {
        roster = await useWorkerStore.getState().refresh(terminalId, procfilePath)
      } catch (e) {
        write(`\r\n\x1b[31m${errorText(e)}\x1b[0m\r\n`)
      }
      processesRef.current = roster

      let raw = ''
      try {
        raw = await channels.worker.bufferReadAll(terminalId)
      } catch (e) {
        dlog('WORKER', `buffer read failed panel=${terminalId}: ${errorText(e)}`)
      }
      const entries = parseWorkerBuffer(raw)
      midLineRef.current = {}
      for (const entry of entries) renderEntry(entry)
      attachedRef.current = true
      if (entries.length === 0) writeHeader(roster.length)

      const deferred = deferredRef.current
      deferredRef.current = []
      for (const entry of deferred) renderEntry(entry)
    } finally {
      attachingRef.current = false
    }
  }, [channels, procfilePath, renderEntry, terminalId, write, writeHeader])

  // Re-read the shared log on refocus: output that arrived while this screen
  // was not listening lives there, and the host is the copy of record.
  const reattach = useCallback(async () => {
    if (!attachedRef.current || !webViewRef.current) return
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    outputBufferRef.current = ''
    deferredRef.current = []
    webViewRef.current.injectJavaScript('window.clearTerminal && window.clearTerminal(); true;')
    attachedRef.current = false
    await attach()
  }, [attach])

  useFocusEffect(
    useCallback(() => {
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true
        return
      }
      reattach().catch(() => undefined)
    }, [reattach]),
  )

  useEffect(() => {
    attachedRef.current = false
    midLineRef.current = {}
    deferredRef.current = []
    outputBufferRef.current = ''
  }, [terminalId])

  useEffect(() => {
    if (!channels) return
    const unsubOutput = channels.pty.onOutput((id, data) => {
      const parts = splitWorkerPtyId(id)
      if (!parts || parts.panelId !== terminalId) return
      const proc = processesRef.current.find(p => p.name === parts.name)
      // Not persisted: the host already wrote it to the shared log.
      emit({ name: parts.name, color: proc?.color ?? '', data }, false)
    })
    const unsubExit = channels.pty.onExit((id, exitCode) => {
      const parts = splitWorkerPtyId(id)
      if (!parts || parts.panelId !== terminalId) return
      const proc = processesRef.current.find(p => p.name === parts.name)
      midLineRef.current[parts.name] = false
      const colorCode = exitCode === 0 ? '32' : '31'
      emit({
        name: parts.name,
        color: proc?.color ?? '',
        data: `\n\x1b[${colorCode}mProcess exited with code ${exitCode}\x1b[0m\n`,
      }, true)
    })
    return () => {
      unsubOutput()
      unsubExit()
    }
  }, [channels, emit, terminalId])

  useEffect(() => () => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
    if (appendTimerRef.current) {
      clearTimeout(appendTimerRef.current)
      flushAppends()
    }
  }, [flushAppends])

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data)
      if (msg.type === 'ready') {
        terminalReadyRef.current = true
        attach().catch(e => dlog('WORKER', `attach failed panel=${terminalId}: ${errorText(e)}`))
      }
      // 'input' is ignored: the log is read-only, there is no shell behind it.
    } catch {
      // ignore
    }
  }, [attach, terminalId])

  useEffect(() => {
    attach().catch(e => dlog('WORKER', `attach failed panel=${terminalId}: ${errorText(e)}`))
  }, [attach, terminalId])

  // ---- Actions -------------------------------------------------------------

  const run = useCallback(async (key: string, action: () => Promise<void>) => {
    setBusyKeys(keys => [...keys, key])
    try {
      await action()
    } catch (e) {
      Alert.alert(t('worker.alerts.actionFailed'), errorText(e))
    } finally {
      setBusyKeys(keys => keys.filter(k => k !== key))
    }
  }, [t])

  const store = useWorkerStore.getState
  const startProcess = (name: string) => run(name, () => store().start(terminalId, name, cwdFallback))
  const stopProcess = (name: string) => run(name, () => store().stop(terminalId, name))
  const restartProcess = (proc: WorkerProcess) => run(proc.name, async () => {
    emit({ name: proc.name, color: proc.color, data: '\n\x1b[33mRestarting...\x1b[0m\n' }, true)
    await store().restart(terminalId, proc.name, cwdFallback)
  })
  const startAll = () => run('__all__', () => store().startAll(terminalId, cwdFallback))
  const stopAll = () => run('__all__', () => store().stopAll(terminalId))

  // The desktop narrates a reload — what was added, dropped or changed — so
  // the same lines land here, and in the shared log for the other client.
  const reloadProcfile = () => run('__all__', async () => {
    if (!procfilePath) return
    const before = processesRef.current
    const after = await store().refresh(terminalId, procfilePath)
    for (const proc of before) {
      if (!after.some(p => p.name === proc.name)) {
        emit({ name: proc.name, color: proc.color, data: '\n\x1b[90mRemoved from Procfile\x1b[0m\n' }, true)
      }
    }
    for (const proc of after) {
      const previous = before.find(p => p.name === proc.name)
      if (!previous) {
        emit({ name: proc.name, color: proc.color, data: '\n\x1b[32mAdded from Procfile\x1b[0m\n' }, true)
      } else if (previous.command !== proc.command) {
        emit({ name: proc.name, color: proc.color, data: `\n\x1b[33mCommand updated: ${proc.command}\x1b[0m\n` }, true)
      }
    }
  })

  const clearLog = () => run('__all__', async () => {
    if (!channels) return
    await channels.worker.bufferClear(terminalId)
    pendingAppendRef.current = []
    outputBufferRef.current = ''
    midLineRef.current = {}
    webViewRef.current?.injectJavaScript('window.clearTerminal && window.clearTerminal(); true;')
    writeHeader(processesRef.current.length)
  })

  const roster = processes ?? []
  const anyBusy = busyKeys.length > 0
  const allBusy = busyKeys.includes('__all__')
  const anyRunning = roster.some(p => p.status === 'running' || p.status === 'starting')
  const anyStopped = roster.some(p => p.status === 'stopped' || p.status === 'crashed')

  return (
    <View style={styles.container}>
      <SessionContextBar workspaceId={terminal?.workspaceId} detail={procfilePath} />
      <SessionWorkspaceTabs sessionId={terminalId} cwd={terminal?.cwd || workspace?.folderPath}>
        <View style={styles.toolbar}>
          <Text style={styles.toolbarTitle}>{t('worker.processes')}</Text>
          <View style={styles.toolbarActions}>
            <ToolbarButton label={t('worker.actions.startAll')} onPress={startAll} disabled={anyBusy || !anyStopped} />
            <ToolbarButton label={t('worker.actions.stopAll')} onPress={stopAll} disabled={anyBusy || !anyRunning} destructive />
            <ToolbarButton label={t('worker.actions.reload')} onPress={reloadProcfile} disabled={allBusy} />
            <ToolbarButton label={t('worker.actions.clearLog')} onPress={clearLog} disabled={allBusy} />
          </View>
        </View>
        <ScrollView style={styles.roster} contentContainerStyle={styles.rosterContent}>
          {rosterError ? <Text style={styles.rosterError} numberOfLines={2}>{rosterError}</Text> : null}
          {roster.length === 0 && !rosterError ? (
            <Text style={styles.rosterEmpty}>{t('worker.noProcesses')}</Text>
          ) : null}
          {roster.map(proc => {
            const busy = busyKeys.includes(proc.name) || allBusy
            const up = proc.status === 'running' || proc.status === 'starting'
            return (
              <View key={proc.name} style={styles.processRow}>
                <View style={[styles.dot, { backgroundColor: proc.color }]} />
                <View style={styles.processInfo}>
                  <Text style={[styles.processName, { color: proc.color }]} numberOfLines={1}>{proc.name}</Text>
                  <Text style={styles.processCommand} numberOfLines={1}>{proc.command}</Text>
                </View>
                <Text style={[styles.processStatus, { color: STATUS_COLOR[proc.status] }]}>
                  {t(`worker.status.${proc.status}`)}
                  {proc.status === 'crashed' && proc.exitCode != null ? ` · ${t('worker.exitCode', { code: proc.exitCode })}` : ''}
                </Text>
                {up ? (
                  <>
                    <ToolbarButton label={t('worker.actions.restart')} onPress={() => restartProcess(proc)} disabled={busy} />
                    <ToolbarButton label={t('worker.actions.stop')} onPress={() => stopProcess(proc.name)} disabled={busy} destructive />
                  </>
                ) : (
                  <ToolbarButton label={t('worker.actions.start')} onPress={() => startProcess(proc.name)} disabled={busy} />
                )}
              </View>
            )
          })}
        </ScrollView>
        <WebView
          ref={webViewRef}
          source={{ html: terminalHtml }}
          style={styles.webview}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
          scrollEnabled={false}
          bounces={false}
          hideKeyboardAccessoryView
          autoManageStatusBarEnabled={false}
        />
      </SessionWorkspaceTabs>
    </View>
  )
}

function ToolbarButton({ label, onPress, disabled, destructive }: {
  label: string
  onPress: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Text style={[styles.buttonText, destructive && styles.buttonTextDestructive]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1f1d1a',
  },
  webview: {
    flex: 1,
    backgroundColor: '#1f1d1a',
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: appColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  toolbarTitle: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    marginRight: spacing.sm,
  },
  toolbarActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    flex: 1,
    justifyContent: 'flex-end',
  },
  roster: {
    maxHeight: 180,
    backgroundColor: appColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  rosterContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  rosterError: {
    color: appColors.error,
    fontSize: fontSize.xs,
    paddingVertical: spacing.xs,
  },
  rosterEmpty: {
    color: appColors.textMuted,
    fontSize: fontSize.xs,
    paddingVertical: spacing.xs,
  },
  processRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  processInfo: {
    flex: 1,
    minWidth: 0,
  },
  processName: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  processCommand: {
    color: appColors.textMuted,
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
  },
  processStatus: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  button: {
    minHeight: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: appColors.accent,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  buttonTextDestructive: {
    color: appColors.error,
  },
  headerTitleWrap: {
    minWidth: 0,
  },
  headerTitle: {
    color: appColors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
  },
  headerButton: {
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  headerButtonText: {
    color: appColors.accent,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
})
