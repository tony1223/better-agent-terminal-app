import React, { useContext, useState } from 'react'
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useFilePreview } from '@/hooks/use-file-preview'
import { appColors, spacing } from '@/theme/colors'
import { FilePreviewModal } from './FilePreviewModal'
import { PreviewNavigation } from './PreviewNavigation'

export function RemoteImagePreview({ path = 'image.png', dataUrl }: { path?: string; dataUrl?: string }) {
  const { t } = useTranslation()
  const { imageUrl, loading, error, disconnected, retry } = useFilePreview(path, dataUrl, true)
  const [open, setOpen] = useState(false)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const navigate = useContext(PreviewNavigation)
  const failed = error || disconnected || (!!imageUrl && failedUrl === imageUrl)
  return (
    <View style={styles.card}>
      {loading && <ActivityIndicator color={appColors.accent} />}
      {failed ? (
        <TouchableOpacity accessibilityRole="button" onPress={() => { setFailedUrl(null); retry() }}>
          <Text style={styles.error} selectable>{disconnected ? t('filePreview.notConnected') : error || t('filePreview.imageUnavailable')}</Text>
          <Text style={styles.caption} selectable>{path}</Text>
          <Text style={styles.caption}>{t('connection.retry')}</Text>
        </TouchableOpacity>
      ) : imageUrl ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('filePreview.openImage')} onPress={() => navigate ? navigate(path, dataUrl) : setOpen(true)}>
          <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="contain" onError={() => setFailedUrl(imageUrl)} />
          <Text style={styles.caption}>{t('filePreview.openImage')}</Text>
        </TouchableOpacity>
      ) : null}
      {open && <FilePreviewModal filePath={path} inlineImage={dataUrl} visible onClose={() => setOpen(false)} />}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.sm, padding: spacing.sm, backgroundColor: appColors.background, borderRadius: 8 },
  image: { width: '100%', height: 220 },
  caption: { color: appColors.textSecondary, marginTop: spacing.xs },
  error: { color: appColors.error },
})
