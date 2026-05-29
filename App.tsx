/**
 * BAT Mobile - Better Agent Terminal mobile client
 */

import React, { useEffect, useRef } from 'react'
import { Linking, StatusBar, View, StyleSheet } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import '@/i18n'
import { RootNavigator } from '@/navigation/RootNavigator'
import { PermissionDialog } from '@/components/claude/PermissionDialog'
import { AskUserDialog } from '@/components/claude/AskUserDialog'
import { useConnectionStore } from '@/stores/connection-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { subscribeClaudeEvents } from '@/stores/claude-store'
import { openConnectionLink } from '@/utils/connection-link'
import { dlog } from '@/utils/debug-log'

function App() {
  const status = useConnectionStore(s => s.status)
  const channels = useConnectionStore(s => s.channels)
  const unsubRef = useRef<(() => void) | null>(null)
  const lastLinkRef = useRef<string | null>(null)

  useEffect(() => {
    dlog('!APP', 'Better Agent Terminal mobile app mounted, build=ios-debug-raw-websocket-tls')
  }, [])

  // When connection is established: load workspace state + subscribe to Claude events
  useEffect(() => {
    if (status === 'connected' && channels) {
      // Load workspace data
      useWorkspaceStore.getState().load()

      // Subscribe to remote events
      const unsubscribeClaude = subscribeClaudeEvents(channels.claude)
      const unsubscribeWorkspaceReload = channels.workspace.onReload((payload) => {
        useWorkspaceStore.getState().applyReload(payload)
      })
      const unsubscribeProfileChanged = channels.profile.onChanged((payload) => {
        const workspaceStore = useWorkspaceStore.getState()
        workspaceStore.applyProfileChanged(payload)
        workspaceStore.loadActiveProfileWorkspace().catch(() => {})
      })
      unsubRef.current = () => {
        unsubscribeClaude()
        unsubscribeWorkspaceReload()
        unsubscribeProfileChanged()
      }
    }

    return () => {
      if (unsubRef.current) {
        unsubRef.current()
        unsubRef.current = null
      }
    }
  }, [status, channels])

  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url || lastLinkRef.current === url) return
      lastLinkRef.current = url
      openConnectionLink(url)
    }

    Linking.getInitialURL().then(handleUrl).catch(() => {})
    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url))
    return () => subscription.remove()
  }, [])

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
        <View style={styles.root}>
          <RootNavigator />
          {/* Global overlays for Claude permission / ask-user dialogs */}
          <PermissionDialog />
          <AskUserDialog />
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
})

export default App
