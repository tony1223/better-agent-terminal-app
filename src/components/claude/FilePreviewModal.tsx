/** Shared host-file preview for chat, image tools and the file browser. */
import React, { useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Clipboard, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { useTranslation } from 'react-i18next'
import { useFilePreview } from '@/hooks/use-file-preview'
import { fileDirectory, isMarkdownFile, resolveHostPath } from '@/utils/file-preview'
import { getFileName } from '@/utils/path-tokenizer'
import { saveBase64File } from '@/utils/file-export'
import { hostMarkdown } from '@/utils/host-markdown'
import { appColors, fontSize, spacing } from '@/theme/colors'
import { createPathLinkerRules } from './LinkedText'
import { PreviewNavigation } from './PreviewNavigation'

interface Props {
  filePath: string
  visible: boolean
  inlineImage?: string
  onClose: () => void
}

export function FilePreviewModal(props: Props) {
  // Remount on a new root/visibility so a reopened preview starts at page one.
  return props.visible ? <PreviewStack key={props.filePath} {...props} /> : null
}

function PreviewStack({ filePath, inlineImage, onClose }: Props) {
  const { t } = useTranslation()
  const rootPath = resolveHostPath(filePath) || filePath
  const [stack, setStack] = useState([{ path: rootPath, inlineImage }])
  const page = stack[stack.length - 1]
  const current = page.path
  const back = () => stack.length > 1 ? setStack(pages => pages.slice(0, -1)) : onClose()
  return (
    <Modal visible transparent animationType="fade" onRequestClose={back}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            {stack.length > 1 && <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('filePreview.back')} onPress={back} style={styles.button}><Text style={styles.buttonText}>←</Text></TouchableOpacity>}
            <View style={styles.title}>
              <Text style={styles.fileName} numberOfLines={1}>{getFileName(current)}</Text>
              <Text style={styles.filePath} selectable>{current}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={styles.button}><Text style={styles.buttonText}>✕</Text></TouchableOpacity>
          </View>
          <PreviewNavigation.Provider value={(path, image) => setStack(pages => [...pages, { path, inlineImage: image }])}>
            <PreviewPage key={`${stack.length}:${current}`} path={current} inlineImage={page.inlineImage} />
          </PreviewNavigation.Provider>
        </View>
      </View>
    </Modal>
  )
}

function PreviewPage({ path, inlineImage }: { path: string; inlineImage?: string }) {
  const { t } = useTranslation()
  const { content, imageUrl, error, loading, disconnected, retry, channels } = useFilePreview(path, inlineImage)
  const [source, setSource] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const rules = useMemo(() => createPathLinkerRules(fileDirectory(path)), [path])
  const problem = disconnected ? t('filePreview.notConnected') : error || (imageUrl && failedImage === imageUrl ? t('filePreview.imageUnavailable') : null)
  const download = async () => {
    if (downloading || (!channels && !inlineImage)) return
    setDownloading(true)
    try {
      // Read original bytes, even when the text preview exceeded the host cap.
      const bytes = inlineImage || await channels!.fs.readImageAsDataUrl(path)
      await saveBase64File(getFileName(path), bytes)
    } catch (e) {
      Alert.alert(t('workspaceDetail.download.failedTitle'), String(e))
    } finally { setDownloading(false) }
  }
  return (
    <View style={styles.page}>
      <View style={styles.toolbar}>
        <TouchableOpacity accessibilityRole="button" style={styles.button} disabled={content === undefined} onPress={() => Clipboard.setString(content || '')}>
          <Text style={styles.buttonText}>{t('common.copy')}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.button} disabled={downloading || disconnected} onPress={download}>
          {downloading ? <ActivityIndicator color={appColors.accent} /> : <Text style={styles.buttonText}>{t('workspaceDetail.button.download')}</Text>}
        </TouchableOpacity>
        {isMarkdownFile(path) && content !== undefined && <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => setSource(value => !value)}><Text style={styles.buttonText}>{t(source ? 'filePreview.rendered' : 'filePreview.source')}</Text></TouchableOpacity>}
      </View>
      {loading && <View style={styles.center}><ActivityIndicator color={appColors.accent} /></View>}
      {!!problem && <View style={styles.center}>
        <Text style={styles.error} selectable>{problem}</Text>
        <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => { setFailedImage(null); retry() }}><Text style={styles.buttonText}>{t('connection.retry')}</Text></TouchableOpacity>
      </View>}
      {!loading && !problem && imageUrl && <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="contain" onError={() => setFailedImage(imageUrl)} />}
      {!loading && !problem && content !== undefined && <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        {isMarkdownFile(path) && !source ? <Markdown markdownit={hostMarkdown} style={markdownStyles} rules={rules}>{content}</Markdown> : <Text style={styles.code} selectable>{content}</Text>}
      </ScrollView>}
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: spacing.md, paddingVertical: spacing.xxl },
  modal: { flex: 1, backgroundColor: appColors.surface, borderRadius: 12, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: appColors.border },
  title: { flex: 1, minWidth: 0 },
  fileName: { color: appColors.accent, fontSize: fontSize.md, fontWeight: '700' },
  filePath: { color: appColors.textSecondary, fontSize: fontSize.xs },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', borderBottomWidth: 1, borderBottomColor: appColors.border },
  button: { padding: spacing.sm },
  buttonText: { color: appColors.accent, fontSize: fontSize.sm },
  page: { flex: 1, backgroundColor: appColors.background },
  content: { padding: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  error: { color: appColors.error },
  image: { flex: 1, width: '100%' },
  code: { color: appColors.text, fontFamily: 'monospace', fontSize: fontSize.sm },
})

const markdownStyles = StyleSheet.create({
  body: { color: appColors.text, fontSize: fontSize.md },
  link: { color: appColors.accent },
  code_inline: { color: appColors.text, backgroundColor: appColors.surface },
  fence: { color: appColors.text, backgroundColor: appColors.surface },
  code_block: { color: appColors.text, backgroundColor: appColors.surface },
})
