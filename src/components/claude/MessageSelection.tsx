import React, { createContext, useCallback, useContext, useState } from 'react'
import { Clipboard, Keyboard, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { appColors, fontSize, spacing } from '@/theme/colors'

const SelectionContext = createContext<((text: string) => void) | null>(null)

/** Lives above the history list: recycling a row or finishing a stream must
 * not dismiss selection. Freeze the text so incoming tokens cannot move it. */
export function MessageSelectionProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const open = useCallback((text: string) => {
    if (!text.trim()) return
    Keyboard.dismiss()
    setCopied(false)
    setSnapshot(text)
  }, [])
  const close = () => setSnapshot(null)

  return (
    <SelectionContext.Provider value={open}>
      {children}
      {snapshot !== null && (
        <Modal visible animationType="slide" onRequestClose={close}>
          <SafeAreaProvider>
            <SafeAreaView style={styles.page}>
              <View style={styles.header}>
                <Text style={styles.title}>{t('messageSelection.title')}</Text>
                <TouchableOpacity accessibilityRole="button" style={styles.button}
                  onPress={() => { Clipboard.setString(snapshot); setCopied(true) }}>
                  <Text style={styles.action}>{t(copied ? 'messageSelection.copied' : 'messageSelection.copyAll')}</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('common.close')}
                  style={styles.button} onPress={close}>
                  <Text style={styles.action}>{t('common.close')}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.hint}>{t('messageSelection.hint')}</Text>
              <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
                {/* ONE native selection surface, never separate Markdown blocks,
                    links or virtualized lines. Preserve exact source whitespace. */}
                <Text testID="message-selection-text" selectable style={styles.text}>{snapshot}</Text>
              </ScrollView>
            </SafeAreaView>
          </SafeAreaProvider>
        </Modal>
      )}
    </SelectionContext.Provider>
  )
}

export function MessageSelectionButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const open = useContext(SelectionContext)
  if (!open || !text.trim()) return null
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('messageSelection.open')}
      style={styles.button} onPress={() => open(text)}>
      <Text style={styles.action}>{t('messageSelection.open')}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: appColors.background },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: appColors.border },
  title: { flexGrow: 1, color: appColors.text, fontSize: fontSize.lg, fontWeight: '600' },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm, alignSelf: 'flex-end' },
  action: { color: appColors.textSecondary, fontSize: fontSize.sm },
  hint: { color: appColors.textSecondary, fontSize: fontSize.sm, padding: spacing.lg },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingTop: 0 },
  text: { color: appColors.text, fontSize: fontSize.lg, lineHeight: 25 },
})
