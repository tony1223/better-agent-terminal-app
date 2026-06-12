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
  const activeLocalProfileId = useWorkspaceStore(s => s.activeLocalProfileId)

  // Every workspace belongs to exactly one profile — show the one this
  // device is viewing, not the host's full active set (the host may have
  // several profiles active at once across desktop windows).
  const viewingProfileId = activeLocalProfileId ?? activeProfileIds[0]
  const viewingProfile = viewingProfileId
    ? profiles.find(profile => profile.id === viewingProfileId)
    : undefined
  const profileLabel = viewingProfile
    ? (viewingProfile.name || viewingProfile.id)
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
