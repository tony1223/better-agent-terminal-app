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
import { appColors, spacing, fontSize } from '@/theme/colors'

interface Props {
  onKey: (data: string) => void
}

interface KeyDef {
  label: string
  data?: string       // Direct data to send
  toggle?: 'ctrl' | 'alt'  // Toggle modifier
}

const KEYS: KeyDef[] = [
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: 'Ctrl', toggle: 'ctrl' },
  { label: 'Alt', toggle: 'alt' },
  { label: '\u2191', data: '\x1b[A' },  // Up arrow
  { label: '\u2193', data: '\x1b[B' },  // Down arrow
  { label: '\u2190', data: '\x1b[D' },  // Left arrow
  { label: '\u2192', data: '\x1b[C' },  // Right arrow
  { label: '|', data: '|' },
  { label: '~', data: '~' },
  { label: '`', data: '`' },
  { label: '-', data: '-' },
  { label: '/', data: '/' },
]

export function TerminalToolbar({ onKey }: Props) {
  const [ctrlActive, setCtrlActive] = useState(false)
  const [altActive, setAltActive] = useState(false)

  const handlePress = useCallback((key: KeyDef) => {
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
  }, [ctrlActive, altActive, onKey])

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
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
    alignItems: 'center',
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
