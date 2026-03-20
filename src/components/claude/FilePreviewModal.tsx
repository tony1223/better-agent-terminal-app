/**
 * FilePreviewModal - Preview remote file content
 * Mobile equivalent of BAT Desktop's FilePreviewModal in PathLinker.tsx
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from 'react-native'
import { useConnectionStore } from '@/stores/connection-store'
import { getFileName } from '@/utils/path-tokenizer'
import { appColors, spacing, fontSize } from '@/theme/colors'

interface Props {
  filePath: string
  visible: boolean
  onClose: () => void
}

const LINE_HEIGHT = 18

export function FilePreviewModal({ filePath, visible, onClose }: Props) {
  const channels = useConnectionStore(s => s.channels)
  const [lines, setLines] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!visible) return
    if (!channels) {
      setLoading(false)
      setError('Not connected to server')
      return
    }
    setLoading(true)
    setError(null)
    setLines([])

    channels.fs.readFile(filePath).then((result: any) => {
      // Server returns { content?: string, error?: string, size?: number }
      if (result?.error) {
        setError(result.error)
      } else if (typeof result?.content === 'string') {
        setLines(result.content.split('\n'))
      } else if (typeof result === 'string') {
        setLines(result.split('\n'))
      } else {
        setError('Unexpected response format')
      }
      setLoading(false)
    }).catch((e: unknown) => {
      setError(String(e))
      setLoading(false)
    })
  }, [visible, filePath, channels])

  const handleCopy = useCallback(() => {
    // TODO: add @react-native-clipboard/clipboard for copy support
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [])

  const renderLine = useCallback(({ item, index }: { item: string; index: number }) => (
    <View style={styles.lineRow}>
      <Text style={styles.lineNum}>{index + 1}</Text>
      <Text style={styles.lineText}>{item || ' '}</Text>
    </View>
  ), [])

  const getItemLayout = useCallback((_: any, index: number) => ({
    length: LINE_HEIGHT,
    offset: LINE_HEIGHT * index,
    index,
  }), [])

  const keyExtractor = useCallback((_: string, index: number) => String(index), [])

  const name = getFileName(filePath)

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerInfo}>
              <Text style={styles.fileName} numberOfLines={1}>{name}</Text>
              <Text style={styles.filePath} numberOfLines={1}>{filePath}</Text>
            </View>
            <TouchableOpacity style={styles.headerBtn} onPress={handleCopy}>
              <Text style={styles.headerBtnText}>{copied ? '\u2713' : 'Copy'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerBtn} onPress={onClose}>
              <Text style={styles.headerBtnText}>{'\u2715'}</Text>
            </TouchableOpacity>
          </View>

          {/* Body */}
          <View style={styles.body}>
            {loading && (
              <View style={styles.center}>
                <ActivityIndicator color={appColors.accent} />
              </View>
            )}
            {error && (
              <View style={styles.center}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
            {!loading && !error && (
              <FlatList
                data={lines}
                renderItem={renderLine}
                keyExtractor={keyExtractor}
                getItemLayout={getItemLayout}
                initialNumToRender={50}
                maxToRenderPerBatch={50}
                windowSize={10}
                style={styles.codeList}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxl,
  },
  modal: {
    flex: 1,
    backgroundColor: appColors.surface,
    borderRadius: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  headerInfo: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: appColors.accent,
    fontFamily: 'monospace',
  },
  filePath: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  headerBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginLeft: spacing.sm,
  },
  headerBtnText: {
    fontSize: fontSize.sm,
    color: appColors.textSecondary,
    fontWeight: '600',
  },
  body: {
    flex: 1,
    backgroundColor: appColors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: appColors.error,
    textAlign: 'center',
  },
  codeList: {
    flex: 1,
  },
  lineRow: {
    flexDirection: 'row',
    height: LINE_HEIGHT,
    paddingHorizontal: spacing.xs,
  },
  lineNum: {
    width: 40,
    textAlign: 'right',
    paddingRight: spacing.sm,
    fontSize: fontSize.xs,
    lineHeight: LINE_HEIGHT,
    color: appColors.textMuted,
    fontFamily: 'monospace',
  },
  lineText: {
    flex: 1,
    fontSize: fontSize.xs,
    lineHeight: LINE_HEIGHT,
    color: appColors.text,
    fontFamily: 'monospace',
  },
})
