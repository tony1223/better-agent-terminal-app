import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { appColors, fontSize, spacing } from '@/theme/colors'

interface Props {
  workspaceId?: string | null
  detail?: string | null
  right?: React.ReactNode
}

export function SessionContextBar({ workspaceId, detail, right }: Props) {
  const { t } = useTranslation()
  const workspace = useWorkspaceStore(s =>
    workspaceId ? s.workspaces.find(w => w.id === workspaceId) : undefined
  )
  const profiles = useWorkspaceStore(s => s.profiles)
  const activeProfileIds = useWorkspaceStore(s => s.activeProfileIds)

  const activeProfiles = activeProfileIds
    .map(id => profiles.find(profile => profile.id === id))
    .filter((profile): profile is NonNullable<typeof profile> => !!profile)
  const profileLabel = activeProfiles.length > 0
    ? activeProfiles.map(profile => profile.name || profile.id).join(', ')
    : t('sessionContext.defaultProfile')
  const workspaceLabel = workspace?.alias || workspace?.name || t('sessionContext.defaultWorkspace')
  const folder = workspace?.folderPath || detail || ''

  return (
    <View style={styles.container}>
      <View style={styles.textBlock}>
        <Text style={styles.primary} numberOfLines={1}>
          {profileLabel}
          <Text style={styles.separator}> / </Text>
          {workspaceLabel}
        </Text>
        {!!folder && (
          <Text style={styles.secondary} numberOfLines={1}>{folder}</Text>
        )}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: appColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  primary: {
    color: appColors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  separator: {
    color: appColors.textMuted,
    fontWeight: '400',
  },
  secondary: {
    marginTop: 2,
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
  },
  right: {
    marginLeft: spacing.md,
  },
})
