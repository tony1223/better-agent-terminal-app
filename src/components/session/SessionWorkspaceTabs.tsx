import React, { useEffect, useState } from 'react'
import { BackHandler, Keyboard, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { FilesPane, GitPane } from '@/screens/WorkspaceDetailScreen'
import { useClaudeStore, EMPTY_SESSION } from '@/stores/claude-store'
import { RuntimeStatusBar } from '@/components/claude/RuntimeStatusBar'
import { ChatTimestamp } from '@/components/claude/ChatTimestamp'
import { appColors, spacing } from '@/theme/colors'

type Tab = 'session' | 'files' | 'git'
const TABS: Tab[] = ['session', 'files', 'git']

/** Local navigation only: the conversation stays mounted, subscribed and laid out. */
export function SessionWorkspaceTabs({ sessionId, cwd, children }: {
  sessionId: string; cwd?: string; children: React.ReactNode
}) {
  const { t } = useTranslation()
  const [active, setActive] = useState<Tab>('session')
  const [visited, setVisited] = useState<Partial<Record<Tab, boolean>>>({})
  const session = useClaudeStore(s => s.sessions[sessionId] || EMPTY_SESSION)
  useEffect(() => { setActive('session'); setVisited({}) }, [sessionId, cwd])
  useFocusEffect(React.useCallback(() => {
    if (active === 'session') return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setActive('session')
      return true
    })
    return () => subscription.remove()
  }, [active]))
  const select = (tab: Tab) => {
    if (tab === active) return
    Keyboard.dismiss()
    setVisited(previous => ({ ...previous, [tab]: true }))
    setActive(tab)
  }
  return (
    <View style={styles.container}>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {TABS.map(tab => <TouchableOpacity key={tab} accessibilityRole="tab"
          accessibilityState={{ selected: active === tab, disabled: tab !== 'session' && !cwd }}
          disabled={tab !== 'session' && !cwd} onPress={() => select(tab)}
          style={[styles.tab, active === tab && styles.selected]}>
          <Text style={[styles.label, active === tab && styles.selectedLabel]}>{t(`sessionTabs.${tab}`)}</Text>
        </TouchableOpacity>)}
      </View>
      <View style={styles.container}>
        {TABS.map(tab => <View key={tab} testID={`session-pane-${tab}`}
          style={[styles.layer, active !== tab && styles.hidden]}
          pointerEvents={active === tab ? 'auto' : 'none'}
          accessibilityElementsHidden={active !== tab}
          importantForAccessibility={active === tab ? 'auto' : 'no-hide-descendants'}>
          {tab === 'session' ? children : cwd && visited[tab] ? <>
            {tab === 'files' ? <FilesPane key={cwd} rootPath={cwd} active={active === tab} /> : <GitPane key={cwd} cwd={cwd} active={active === tab} />}
            <View style={styles.returnBar}>
              <TouchableOpacity style={styles.returnButton} onPress={() => select('session')} accessibilityRole="button">
              <Text style={styles.label}>{t('sessionTabs.returnToSession')}</Text>
              </TouchableOpacity>
              {session.lastDataAt != null && <View><Text style={styles.label}>{t('sessionTabs.lastData')}</Text><ChatTimestamp timestamp={session.lastDataAt} /></View>}
            </View>
            <RuntimeStatusBar runtimeStatus={session.meta?.runtimeStatus ?? (session.isStreaming ? 'working' : null)}
              runtimeSince={session.runtimeStatusSince} turnStartedAt={session.turnStartedAt}
              responding={!!session.streamingText} thinking={!!session.streamingThinking} />
          </> : null}
        </View>)}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabs: { flexDirection: 'row', backgroundColor: appColors.surface, borderBottomWidth: 1, borderBottomColor: appColors.border },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  selected: { borderBottomColor: appColors.accent },
  label: { color: appColors.textSecondary },
  selectedLabel: { color: appColors.accent, fontWeight: '700' },
  layer: { ...StyleSheet.absoluteFillObject, backgroundColor: appColors.background },
  // Unlike display:none, this retains the chat viewport's dimensions and its
  // scroll offset. Unlike conditional rendering, it retains drafts and refs.
  hidden: { opacity: 0, zIndex: -1 },
  returnBar: { minHeight: 44, padding: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: appColors.border },
  returnButton: { minHeight: 44, justifyContent: 'center' },
})
