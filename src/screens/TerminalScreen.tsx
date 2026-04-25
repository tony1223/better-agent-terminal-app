/**
 * TerminalScreen - Full-screen terminal with WebView + xterm.js
 */

import React, { useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native'
import { WebView } from 'react-native-webview'
import type { WebViewMessageEvent } from 'react-native-webview'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useConnectionStore } from '@/stores/connection-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { appColors, fontSize, spacing } from '@/theme/colors'
import { TerminalToolbar } from '@/components/terminal/TerminalToolbar'
import { terminalHtml } from '@/components/terminal/terminal-html'
import { HIDDEN_TAB_BAR_STYLE, MAIN_TAB_BAR_STYLE } from '@/navigation/tabBarStyle'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'

type Props = NativeStackScreenProps<any, 'Terminal'>

export function TerminalScreen({ route, navigation }: Props) {
  const terminalId = route.params?.terminalId as string
  const webViewRef = useRef<WebView>(null)
  const insets = useSafeAreaInsets()
  const channels = useConnectionStore(s => s.channels)
  const terminal = useWorkspaceStore(s => s.terminals.find(t => t.id === terminalId))

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
      title: terminal?.alias || terminal?.title || 'Terminal',
      headerStyle: { backgroundColor: appColors.surface },
      headerTintColor: appColors.text,
    })

    return () => {
      parent?.setOptions({ tabBarStyle: MAIN_TAB_BAR_STYLE })
    }
  }, [navigation, terminal, terminalId])
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

  // Subscribe to PTY output
  useEffect(() => {
    if (!channels) return

    const unsub = channels.pty.onOutput((id: string, data: string) => {
      if (id !== terminalId) return
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

  // Handle messages from WebView
  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    if (!channels) return

    try {
      const msg = JSON.parse(event.nativeEvent.data)
      switch (msg.type) {
        case 'input':
          channels.pty.write(terminalId, msg.data)
          break
        case 'resize':
          channels.pty.resize(terminalId, msg.cols, msg.rows)
          break
        case 'ready':
          // Terminal WebView is ready
          break
      }
    } catch {
      // ignore
    }
  }, [channels, terminalId])

  // Send special key from toolbar
  const handleSpecialKey = useCallback((data: string) => {
    if (!channels) return
    channels.pty.write(terminalId, data)
  }, [channels, terminalId])

  return (
    <View style={styles.container}>
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
      <View style={[styles.toolbarFrame, { paddingBottom: insets.bottom }]}>
        <TerminalToolbar onKey={handleSpecialKey} />
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
})
