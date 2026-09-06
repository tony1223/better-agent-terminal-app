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
import { ConnectionBanner } from '@/components/ConnectionBanner'
import { useConnectionStore } from '@/stores/connection-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { subscribeClaudeEvents } from '@/stores/claude-store'
import { useUsageStore } from '@/stores/usage-store'
import { openConnectionLink } from '@/utils/connection-link'
import { dlog } from '@/utils/debug-log'
import { appVersionLabel } from '@/native/app-info'

function App() {
  const status = useConnectionStore(s => s.status)
  const channels = useConnectionStore(s => s.channels)
  const unsubRef = useRef<(() => void) | null>(null)
  const lastLinkRef = useRef<string | null>(null)

  useEffect(() => {
    // First line of every debug log, so it has to answer the question the log
    // is being read to settle: which build produced the rest of this. It used
    // to answer "ios-debug-raw-websocket-tls", which was true of a branch, once.
    dlog('!APP', `Better Agent Terminal mobile app mounted, version=${appVersionLabel}`)
  }, [])

  // When connection is established: load workspace state + subscribe to Claude events
  useEffect(() => {
    if (status === 'connected' && channels) {
      // Load workspace data
      if (useConnectionStore.getState().profileStatus !== 'loading') {
        useWorkspaceStore.getState().load().catch(e => dlog('PROFILE', String(e)))
      }

      // Subscribe to remote events
      const unsubscribeClaude = subscribeClaudeEvents(channels.claude)

      // The quota broadcast is every ~150s, so connecting just after a tick
      // would leave the 5h/7d chips blank for most of the wait. Hosts that
      // predate the pull channel answer with an error; the broadcast still
      // arrives eventually, so there is nothing to tell the user about.
      channels.claude.getUsageSnapshot()
        .then(snapshot => {
          if (useConnectionStore.getState().channels === channels) useUsageStore.getState().applyHostSnapshotMap(snapshot)
        })
        .catch(e => dlog('USAGE', `host has no usage-snapshot channel: ${e instanceof Error ? e.message : String(e)}`))

      const unsubscribeWorkspaceReload = channels.workspace.onReload((payload) => {
        useWorkspaceStore.getState().applyReload(payload)
      })
      const unsubscribeProfileChanged = channels.profile.onChanged((payload) => {
        useWorkspaceStore.getState().handleProfileChanged(payload)
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
          <ConnectionBanner />
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
