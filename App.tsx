/**
 * BAT Mobile - Better Agent Terminal mobile client
 */

import React, { useEffect, useRef } from 'react'
import { StatusBar, View, StyleSheet } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { RootNavigator } from '@/navigation/RootNavigator'
import { PermissionDialog } from '@/components/claude/PermissionDialog'
import { AskUserDialog } from '@/components/claude/AskUserDialog'
import { useConnectionStore } from '@/stores/connection-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { subscribeClaudeEvents } from '@/stores/claude-store'

function App() {
  const status = useConnectionStore(s => s.status)
  const channels = useConnectionStore(s => s.channels)
  const unsubRef = useRef<(() => void) | null>(null)

  // When connection is established: load workspace state + subscribe to Claude events
  useEffect(() => {
    if (status === 'connected' && channels) {
      // Load workspace data
      useWorkspaceStore.getState().load()

      // Subscribe to Claude events
      unsubRef.current = subscribeClaudeEvents(channels.claude)
    }

    return () => {
      if (unsubRef.current) {
        unsubRef.current()
        unsubRef.current = null
      }
    }
  }, [status, channels])

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
