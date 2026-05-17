/**
 * TerminalScreen - Full-screen terminal with WebView + xterm.js
 */

import React, { useRef, useEffect, useCallback, useLayoutEffect, useState } from 'react'
import { View, StyleSheet, TouchableOpacity, Text, TextInput } from 'react-native'
import { WebView } from 'react-native-webview'
import type { WebViewMessageEvent } from 'react-native-webview'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useConnectionStore } from '@/stores/connection-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { appColors, fontSize, spacing } from '@/theme/colors'
import { TerminalToolbar } from '@/components/terminal/TerminalToolbar'
import { terminalHtml } from '@/components/terminal/terminal-html'
import { SessionContextBar } from '@/components/session/SessionContextBar'
import { HIDDEN_TAB_BAR_STYLE, MAIN_TAB_BAR_STYLE } from '@/navigation/tabBarStyle'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { TerminalViewportState } from '@/types'

type Props = NativeStackScreenProps<any, 'Terminal'>
const MOBILE_TERMINAL_COLS = 56
const MOBILE_TERMINAL_ROWS = 24
const TERMINAL_REPLAY_TIMEOUT_MS = 1500
const DEFAULT_VIEWPORT_STATE: TerminalViewportState = {
  mode: 'desktop',
  cols: 100,
  rows: 30,
  updatedBy: 'desktop',
  updatedAt: 0,
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out waiting for terminal replay')), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export function TerminalScreen({ route, navigation }: Props) {
  const terminalId = route.params?.terminalId as string
  const webViewRef = useRef<WebView>(null)
  const insets = useSafeAreaInsets()
  const channels = useConnectionStore(s => s.channels)
  const terminal = useWorkspaceStore(s => s.terminals.find(t => t.id === terminalId))
  const workspace = useWorkspaceStore(s => {
    const term = s.terminals.find(t => t.id === terminalId)
    return term ? s.workspaces.find(w => w.id === term.workspaceId) : undefined
  })
  const terminalReadyRef = useRef(false)
  const keyboardInputRef = useRef<TextInput>(null)
  const ptyCreateStartedRef = useRef(false)
  const sizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const bufferReplayedRef = useRef(false)
  const deferredOutputRef = useRef('')
  const [viewportState, setViewportState] = useState<TerminalViewportState>(DEFAULT_VIEWPORT_STATE)
  const [keyboardFocused, setKeyboardFocused] = useState(false)
  const [keyboardCaptureValue, setKeyboardCaptureValue] = useState('')
  const viewportStateRef = useRef<TerminalViewportState>(DEFAULT_VIEWPORT_STATE)

  // Terminal detail needs the full bottom edge for the special-key toolbar.
  useLayoutEffect(() => {
    const parent = navigation.getParent()
    parent?.setOptions({ tabBarStyle: HIDDEN_TAB_BAR_STYLE })

    navigation.setOptions({
      headerShown: true,
      headerRight: terminal?.agentPreset === 'claude-code'
        ? () => (
          <TouchableOpacity
            onPress={() => navigation.navigate('Claude', { sessionId: terminalId })}
            style={{ paddingHorizontal: spacing.md }}
          >
            <Text style={{ color: appColors.accent, fontSize: fontSize.md, fontWeight: '700' }}>
              {'\u2726'} Claude
            </Text>
          </TouchableOpacity>
        )
        : undefined,
      headerTitle: () => (
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {workspace?.alias || workspace?.name || 'Workspace'}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {terminal?.alias || terminal?.title || 'Terminal'}
          </Text>
        </View>
      ),
      headerStyle: { backgroundColor: appColors.surface },
      headerTintColor: appColors.text,
    })

    return () => {
      parent?.setOptions({ tabBarStyle: MAIN_TAB_BAR_STYLE })
    }
  }, [navigation, terminal, terminalId, workspace])
  const outputBufferRef = useRef('')
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Batch output for performance (flush every 16ms)
  const flushOutput = useCallback(() => {
    if (outputBufferRef.current && webViewRef.current) {
      const data = outputBufferRef.current
      outputBufferRef.current = ''
      // Escape for JSON string embedding
      const escaped = JSON.stringify(data)
      webViewRef.current.injectJavaScript(
        `window.handleOutput(${escaped}); true;`
      )
    }
    flushTimerRef.current = null
  }, [])

  const writeToTerminal = useCallback((data: string) => {
    if (!webViewRef.current) return
    webViewRef.current.injectJavaScript(
      `window.handleOutput(${JSON.stringify(data)}); true;`
    )
  }, [])

  const replayTerminalBuffer = useCallback(async () => {
    if (!channels || bufferReplayedRef.current) return

    let replay = ''
    try {
      replay = await withTimeout(channels.pty.readBuffer(terminalId), TERMINAL_REPLAY_TIMEOUT_MS)
    } catch {
      replay = Array.isArray(terminal?.scrollbackBuffer)
        ? terminal.scrollbackBuffer.join('')
        : ''
    }

    const deferred = deferredOutputRef.current
    deferredOutputRef.current = ''
    if (replay) {
      writeToTerminal(replay)
    }
    bufferReplayedRef.current = true

    // If live events arrived while the replay RPC was in flight, only write
    // them when they are not already included in the replay snapshot.
    if (deferred && (!replay || !replay.endsWith(deferred))) {
      writeToTerminal(deferred)
    }
  }, [channels, terminal, terminalId, writeToTerminal])

  const applyViewportState = useCallback((state: TerminalViewportState) => {
    viewportStateRef.current = state
    setViewportState(state)
    webViewRef.current?.injectJavaScript(
      `window.handleViewportState(${JSON.stringify(state)}); true;`
    )
  }, [])

  const ensurePty = useCallback(async () => {
    if (!channels || !terminal || ptyCreateStartedRef.current) return
    if (!terminalReadyRef.current) return
    ptyCreateStartedRef.current = true

    try {
      await channels.pty.create({
        id: terminalId,
        cwd: terminal.cwd,
        type: 'terminal',
        agentPreset: terminal.agentPreset,
      })
    } catch (e) {
      const message = String(e)
      if (!message.includes('already exists')) {
        writeToTerminal(`\r\n\x1b[31m${message}\x1b[0m\r\n`)
        return
      }
    }

    try {
      const state = await channels.pty.getViewportState(terminalId)
      applyViewportState(state)
    } catch {
      applyViewportState(DEFAULT_VIEWPORT_STATE)
    }
    await replayTerminalBuffer()
  }, [applyViewportState, channels, replayTerminalBuffer, terminal, terminalId, writeToTerminal])

  // Subscribe to PTY output
  useEffect(() => {
    if (!channels) return

    const unsub = channels.pty.onOutput((id: string, data: string) => {
      if (id !== terminalId) return
      if (!bufferReplayedRef.current) {
        deferredOutputRef.current += data
        return
      }
      outputBufferRef.current += data
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(flushOutput, 16)
      }
    })

    return () => {
      unsub()
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
      }
    }
  }, [channels, terminalId, flushOutput])

  useEffect(() => {
    ptyCreateStartedRef.current = false
    bufferReplayedRef.current = false
    deferredOutputRef.current = ''
    outputBufferRef.current = ''
  }, [terminalId])

  useEffect(() => {
    if (!channels) return
    return channels.pty.onViewportState((id, state) => {
      if (id !== terminalId) return
      applyViewportState(state)
    })
  }, [applyViewportState, channels, terminalId])

  // Handle messages from WebView
  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    if (!channels) return

    try {
      const msg = JSON.parse(event.nativeEvent.data)
      switch (msg.type) {
        case 'input':
          channels.pty.write(terminalId, msg.data)
            .catch(e => writeToTerminal(`\r\n\x1b[31m${String(e)}\x1b[0m\r\n`))
          break
        case 'resize':
          sizeRef.current = { cols: msg.cols, rows: msg.rows }
          if (viewportStateRef.current.mode === 'mobile') {
            channels.pty.setViewportSize(terminalId, msg.cols, msg.rows, 'mobile')
              .then(applyViewportState)
              .catch(() => {})
          }
          break
        case 'ready':
          terminalReadyRef.current = true
          ensurePty()
          applyViewportState(viewportStateRef.current)
          break
      }
    } catch {
      // ignore
    }
  }, [channels, terminalId, ensurePty, writeToTerminal])

  useEffect(() => {
    ensurePty()
  }, [ensurePty])

  // Send special key from toolbar
  const handleSpecialKey = useCallback((data: string) => {
    if (!channels) return
    channels.pty.write(terminalId, data)
      .catch(e => writeToTerminal(`\r\n\x1b[31m${String(e)}\x1b[0m\r\n`))
    if (keyboardFocused) {
      setTimeout(() => keyboardInputRef.current?.focus(), 0)
    }
  }, [channels, keyboardFocused, terminalId, writeToTerminal])

  const sendKeyboardInput = useCallback((data: string) => {
    if (!channels || !data) return
    channels.pty.write(terminalId, data)
      .catch(e => writeToTerminal(`\r\n\x1b[31m${String(e)}\x1b[0m\r\n`))
  }, [channels, terminalId, writeToTerminal])

  const handleKeyboardText = useCallback((text: string) => {
    if (!text) {
      setKeyboardCaptureValue('')
      return
    }
    sendKeyboardInput(text.replace(/\n/g, '\r'))
    setKeyboardCaptureValue('')
  }, [sendKeyboardInput])

  const handleKeyboardKeyPress = useCallback((event: { nativeEvent: { key: string } }) => {
    if (event.nativeEvent.key === 'Backspace') {
      sendKeyboardInput('\x7f')
    }
  }, [sendKeyboardInput])

  const focusKeyboard = useCallback(() => {
    keyboardInputRef.current?.focus()
    webViewRef.current?.injectJavaScript('window.focusTerminal && window.focusTerminal(); true;')
  }, [])

  const handleViewportToggle = useCallback(async () => {
    if (!channels) return
    try {
      if (viewportStateRef.current.mode === 'mobile') {
        const next = await channels.pty.setViewportMode(terminalId, 'desktop', { source: 'mobile' })
        applyViewportState(next)
        return
      }
      const next = await channels.pty.setViewportMode(terminalId, 'mobile', {
        cols: MOBILE_TERMINAL_COLS,
        rows: MOBILE_TERMINAL_ROWS,
        source: 'mobile',
      })
      applyViewportState(next)
    } catch (e) {
      writeToTerminal(`\r\n\x1b[31m${String(e)}\x1b[0m\r\n`)
    }
  }, [applyViewportState, channels, terminalId, writeToTerminal])

  const isMobileLayout = viewportState.mode === 'mobile'

  return (
    <View style={styles.container}>
      <SessionContextBar
        workspaceId={terminal?.workspaceId}
        detail={terminal?.cwd}
        right={(
          <TouchableOpacity
            style={[styles.layoutButton, isMobileLayout && styles.layoutButtonActive]}
            onPress={handleViewportToggle}
            activeOpacity={0.8}
          >
            <Text style={[styles.layoutButtonText, isMobileLayout && styles.layoutButtonTextActive]}>
              {isMobileLayout ? 'Mobile Layout' : 'Desktop Layout'}
            </Text>
          </TouchableOpacity>
        )}
      />
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
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView={false}
        autoManageStatusBarEnabled={false}
      />
      <TextInput
        ref={keyboardInputRef}
        value={keyboardCaptureValue}
        onChangeText={handleKeyboardText}
        onKeyPress={handleKeyboardKeyPress}
        onFocus={() => setKeyboardFocused(true)}
        onBlur={() => setKeyboardFocused(false)}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        multiline
        caretHidden
        style={styles.keyboardCapture}
      />
      <View style={[styles.toolbarFrame, { paddingBottom: insets.bottom }]}>
        <TerminalToolbar
          onKey={handleSpecialKey}
          onKeyboardPress={focusKeyboard}
          keyboardActive={keyboardFocused}
        />
      </View>
    </View>
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
  toolbarFrame: {
    backgroundColor: appColors.surface,
  },
  keyboardCapture: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -10,
    bottom: 0,
  },
  layoutButton: {
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: appColors.background,
  },
  layoutButtonActive: {
    borderColor: appColors.accent,
    backgroundColor: appColors.accentDim,
  },
  layoutButtonText: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  layoutButtonTextActive: {
    color: appColors.text,
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
})
