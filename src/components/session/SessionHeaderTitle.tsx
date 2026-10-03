import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { appColors, fontSize } from '@/theme/colors'
import { SessionRenameButton } from './SessionRenameButton'

/** Subscribe here so a desktop or mobile rename also updates an open chat. */
export function SessionHeaderTitle({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const terminal = useWorkspaceStore(s => s.terminals.find(item => item.id === sessionId))
  const workspace = useWorkspaceStore(s => s.workspaces.find(item => item.id === terminal?.workspaceId))
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>{terminal?.alias || terminal?.title || t('claude.defaultTitle')}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{workspace?.alias || workspace?.name || t('claude.defaultWorkspace')}</Text>
      </View>
      {terminal ? <SessionRenameButton terminal={terminal} compact /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, maxWidth: '100%' },
  text: { flexShrink: 1, minWidth: 0 },
  title: { color: appColors.text, fontSize: fontSize.md, fontWeight: '600' },
  subtitle: { color: appColors.textSecondary, fontSize: fontSize.xs },
})
