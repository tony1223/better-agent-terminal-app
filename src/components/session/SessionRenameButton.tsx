import React, { useRef, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useConnectionStore } from '@/stores/connection-store'
import type { TerminalInstance } from '@/types'
import { appColors, fontSize, spacing } from '@/theme/colors'

export function SessionRenameButton({ terminal, disabled = false, compact = false }: {
  terminal: TerminalInstance; disabled?: boolean; compact?: boolean
}) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const owner = useRef(useConnectionStore.getState().channels)
  const profile = useRef(useWorkspaceStore.getState().activeLocalProfileId)
  const open = () => {
    owner.current = useConnectionStore.getState().channels
    profile.current = useWorkspaceStore.getState().activeLocalProfileId
    setName(terminal.alias || terminal.title)
    setError('')
    setVisible(true)
  }
  const save = async () => {
    if (pending.current || !name.trim()) return
    pending.current = true
    setSaving(true)
    setError('')
    try {
      if (owner.current !== useConnectionStore.getState().channels || profile.current !== useWorkspaceStore.getState().activeLocalProfileId) {
        throw new Error(t('session.rename.profileChanged'))
      }
      await useWorkspaceStore.getState().renameSession(terminal.id, name)
      setVisible(false)
    } catch {
      setError(t('session.rename.failed'))
    } finally { pending.current = false; setSaving(false) }
  }
  return (
    <>
      <TouchableOpacity onPress={open} disabled={disabled} accessibilityRole="button"
        accessibilityLabel={t('session.rename.title')} style={styles.button}>
        <Text style={styles.label}>{compact ? '✎' : t('session.rename.button')}</Text>
      </TouchableOpacity>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!pending.current) setVisible(false) }}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.dialog}>
            <Text style={styles.title}>{t('session.rename.title')}</Text>
            <TextInput value={name} onChangeText={setName} autoFocus selectTextOnFocus editable={!saving}
              accessibilityLabel={t('session.rename.name')} placeholder={t('session.rename.name')}
              placeholderTextColor={appColors.textMuted} style={styles.input} returnKeyType="done" onSubmitEditing={save} />
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.button} disabled={saving} onPress={() => setVisible(false)}>
                <Text style={styles.label}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, (!name.trim() || saving) && styles.disabled]} disabled={!name.trim() || saving} onPress={save}>
                <Text style={styles.label}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  button: { minHeight: 36, minWidth: 36, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.sm },
  label: { color: appColors.accent, fontSize: fontSize.sm },
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(0,0,0,0.6)' },
  dialog: { backgroundColor: appColors.surface, borderRadius: 12, padding: spacing.lg, width: '100%', maxWidth: 440, alignSelf: 'center' },
  title: { color: appColors.text, fontSize: fontSize.lg, fontWeight: '600', marginBottom: spacing.md },
  input: { color: appColors.text, borderColor: appColors.borderStrong, borderWidth: 1, borderRadius: 6, padding: spacing.md, fontSize: fontSize.md },
  error: { color: appColors.error, marginTop: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  disabled: { opacity: 0.4 },
})
