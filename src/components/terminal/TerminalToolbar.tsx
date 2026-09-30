/**
 * TerminalToolbar - Special keys toolbar for mobile terminal input
 * Provides Esc, Tab, Ctrl, Alt, arrow keys, and other special characters
 */

import React, { useState, useCallback } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { appColors, spacing, fontSize } from '@/theme/colors'

interface Props {
  onKey: (data: string) => void
  onKeyboardPress?: () => void
  keyboardActive?: boolean
}

interface KeyDef {
  label: string
  data?: string // Direct data to send
  toggle?: 'ctrl' | 'alt' // Toggle modifier
}

const KEYS: KeyDef[] = [
  { label: 'Tab', data: '\t' },
  { label: 'Ctrl', toggle: 'ctrl' },
  { label: 'Alt', toggle: 'alt' },
  { label: '\u2191', data: '\x1b[A' }, // Up arrow
  { label: '\u2193', data: '\x1b[B' }, // Down arrow
  { label: '\u2190', data: '\x1b[D' }, // Left arrow
  { label: '\u2192', data: '\x1b[C' }, // Right arrow
  { label: '|', data: '|' },
  { label: '~', data: '~' },
  { label: '`', data: '`' },
  { label: '-', data: '-' },
  { label: '/', data: '/' },
]

export function TerminalToolbar({
  onKey,
  onKeyboardPress,
  keyboardActive = false,
}: Props) {
  const { t } = useTranslation()
  const [ctrlActive, setCtrlActive] = useState(false)
  const [altActive, setAltActive] = useState(false)

  const handlePress = useCallback(
    (key: KeyDef) => {
      if (key.toggle === 'ctrl') {
        setCtrlActive(prev => !prev)
        return
      }
      if (key.toggle === 'alt') {
        setAltActive(prev => !prev)
        return
      }
      if (key.data) {
        let data = key.data
        // Apply Ctrl modifier
        if (ctrlActive && data.length === 1) {
          const code = data.toUpperCase().charCodeAt(0)
          if (code >= 64 && code <= 95) {
            // Ctrl+A = 0x01, Ctrl+Z = 0x1a, Ctrl+C = 0x03, etc.
            data = String.fromCharCode(code - 64)
          }
          setCtrlActive(false)
        }
        // Apply Alt modifier
        if (altActive && data.length === 1) {
          data = '\x1b' + data
          setAltActive(false)
        }
        onKey(data)
      }
    },
    [ctrlActive, altActive, onKey],
  )

  return (
    <View style={styles.container}>
      <View style={styles.interrupts}>
        {[
          { label: 'Ctrl+C', data: '\x03' },
          { label: 'Esc', data: '\x1b' },
          { label: 'Enter', data: '\r' },
        ].map(key => (
          <TouchableOpacity
            key={key.label}
            testID={`terminal-key-${key.label}`}
            accessibilityRole="button"
            accessibilityLabel={key.label}
            style={styles.key}
            onPress={() => {
              setCtrlActive(false)
              setAltActive(false)
              onKey(key.data)
            }}
          >
            <Text
              style={[
                styles.keyText,
                key.label !== 'Enter' && { color: appColors.error },
              ]}
            >
              {key.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {onKeyboardPress && (
          <TouchableOpacity
            style={[
              styles.key,
              styles.keyboardKey,
              keyboardActive && styles.keyActive,
            ]}
            onPress={onKeyboardPress}
            accessibilityLabel={t('terminalToolbar.showKeyboard')}
          >
            <Text
              style={[styles.keyText, keyboardActive && styles.keyTextActive]}
            >
              {'\u2328'}
            </Text>
          </TouchableOpacity>
        )}
        {KEYS.map((key, i) => {
          const isActive =
            (key.toggle === 'ctrl' && ctrlActive) ||
            (key.toggle === 'alt' && altActive)

          return (
            <TouchableOpacity
              key={i}
              style={[styles.key, isActive && styles.keyActive]}
              onPress={() => handlePress(key)}
            >
              <Text style={[styles.keyText, isActive && styles.keyTextActive]}>
                {key.label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  interrupts: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  container: {
    backgroundColor: appColors.surface,
    borderTopWidth: 1,
    borderTopColor: appColors.border,
  },
  scroll: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  key: {
    backgroundColor: appColors.surfaceHover,
    borderRadius: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: 3,
    minWidth: 36,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyboardKey: {
    borderWidth: 1,
    borderColor: appColors.accent,
  },
  keyActive: {
    backgroundColor: appColors.accent,
  },
  keyText: {
    fontSize: fontSize.sm,
    color: appColors.text,
    fontWeight: '600',
  },
  keyTextActive: {
    color: '#ffffff',
  },
})
