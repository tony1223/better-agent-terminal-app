import React, { useState } from 'react'
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { appColors, fontSize, spacing } from '@/theme/colors'
import { WorkspaceBrowser } from '@/components/workspace/WorkspaceBrowser'
import { useWorkspaceNavigationStore } from '@/stores/workspace-navigation-store'
import type { WorkspaceEntry } from '@/stores/workspace-browser-store'

interface Props {
  workspaceId?: string | null
  detail?: string | null
  right?: React.ReactNode
}

export function SessionContextBar({ workspaceId, detail, right }: Props) {
  const { t } = useTranslation()
  const navigation = useNavigation<any>()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const workspace = useWorkspaceStore(s =>
    workspaceId ? s.workspaces.find(w => w.id === workspaceId) : undefined,
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
    ? viewingProfile.name || viewingProfile.id
    : t('sessionContext.defaultProfile')
  const workspaceLabel =
    workspace?.alias || workspace?.name || t('sessionContext.defaultWorkspace')
  const folder = workspace?.folderPath || detail || ''
  const openWorkspace = (entry: WorkspaceEntry) => {
    if (useWorkspaceNavigationStore.getState().pending) return
    setSwitcherOpen(false)
    if (entry.profileId === viewingProfileId) {
      useWorkspaceStore.getState().switchWorkspace(entry.workspaceId)
      navigation
        .getParent()
        ?.navigate('Workspaces', {
          screen: 'WorkspaceDetail',
          params: { workspaceId: entry.workspaceId },
        })
      return
    }
    const opening = useWorkspaceNavigationStore.getState().open(entry)
    navigation.getParent()?.navigate('Workspaces', { screen: 'WorkspaceList' })
    return opening
  }
  const openProfile = (profileId: string) => {
    if (useWorkspaceNavigationStore.getState().pending) return
    setSwitcherOpen(false)
    const opening = useWorkspaceNavigationStore
      .getState()
      .open({ profileId, workspaceId: null })
    navigation.getParent()?.navigate('Workspaces', { screen: 'WorkspaceList' })
    return opening
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.textBlock}
        accessibilityRole="button"
        accessibilityLabel={t('workspaceBrowser.switchWorkspace')}
        testID="session-workspace-switcher"
        onPress={() => setSwitcherOpen(true)}
      >
        <Text style={styles.primary} numberOfLines={1}>
          {profileLabel}
          <Text style={styles.separator}> / </Text>
          {workspaceLabel}
          <Text style={styles.separator}> ▾</Text>
        </Text>
        {!!folder && (
          <Text style={styles.secondary} numberOfLines={1}>
            {folder}
          </Text>
        )}
      </TouchableOpacity>
      {right ? <View style={styles.right}>{right}</View> : null}
      <Modal
        visible={switcherOpen}
        animationType="slide"
        onRequestClose={() => setSwitcherOpen(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.primary}>
              {t('workspaceBrowser.switchWorkspace')}
            </Text>
            <TouchableOpacity
              style={styles.close}
              onPress={() => setSwitcherOpen(false)}
            >
              <Text style={styles.primary}>
                {t('workspaceList.button.close')}
              </Text>
            </TouchableOpacity>
          </View>
          {switcherOpen && (
            <WorkspaceBrowser
              onOpen={openWorkspace}
              onOpenProfile={openProfile}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: appColors.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  close: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
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
