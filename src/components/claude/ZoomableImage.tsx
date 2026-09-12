import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { GestureResponderEvent } from 'react-native'
import { useTranslation } from 'react-i18next'
import { appColors } from '@/theme/colors'
import { clampImageTransform, FIT_IMAGE, moveImageGesture, zoomImageAt } from '@/utils/image-zoom'
import type { ImageBounds, Point, ZoomTransform } from '@/utils/image-zoom'

export function ZoomableImage({ uri, onError }: { uri: string; onError?: () => void }) {
  const { t } = useTranslation()
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const [transform, setTransform] = useState<ZoomTransform>(FIT_IMAGE)
  const factor = natural.width && natural.height ? Math.min(viewport.width / natural.width, viewport.height / natural.height) : 1
  const bounds: ImageBounds = { ...viewport, imageWidth: natural.width ? natural.width * factor : viewport.width, imageHeight: natural.height ? natural.height * factor : viewport.height }
  const live = useRef({ transform, bounds })
  live.current = { transform, bounds }
  const gesture = useRef<{ points: Point[]; start: ZoomTransform; time: number; tap: boolean } | null>(null)
  const lastTap = useRef<{ time: number; point: Point } | null>(null)
  const apply = useCallback((next: ZoomTransform) => { live.current.transform = next; setTransform(next) }, [])
  useEffect(() => { setNatural({ width: 0, height: 0 }); setTransform(FIT_IMAGE); gesture.current = null; lastTap.current = null }, [uri])
  useEffect(() => { apply(FIT_IMAGE) }, [viewport.width, viewport.height, apply])
  const responder = useMemo(() => {
    const points = (event: GestureResponderEvent) => event.nativeEvent.touches.slice(0, 2).map(touch => ({ x: touch.locationX, y: touch.locationY }))
    const begin = (event: GestureResponderEvent) => {
      const next = points(event)
      gesture.current = { points: next, start: live.current.transform, time: Date.now(), tap: next.length === 1 }
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: begin,
      onPanResponderMove: event => {
        const next = points(event)
        if (!next.length) return
        const start = gesture.current
        if (!start || next.length !== start.points.length) { begin(event); if (gesture.current) gesture.current.tap = false; return }
        if (next.length > 1 || Math.hypot(next[0].x - start.points[0].x, next[0].y - start.points[0].y) > 6) start.tap = false
        apply(moveImageGesture(start.start, start.points, next, live.current.bounds))
      },
      onPanResponderRelease: () => {
        const start = gesture.current
        const now = Date.now()
        if (start?.tap && now - start.time < 250) {
          const point = start.points[0]
          if (lastTap.current && now - lastTap.current.time < 320 && Math.hypot(point.x - lastTap.current.point.x, point.y - lastTap.current.point.y) < 25) {
            apply(zoomImageAt(live.current.transform, live.current.transform.scale > 1 ? 1 : 2.5, point, live.current.bounds))
            lastTap.current = null
          } else lastTap.current = { time: now, point }
        } else lastTap.current = null
        gesture.current = null
      },
      onPanResponderTerminate: () => { gesture.current = null; lastTap.current = null },
      onPanResponderTerminationRequest: () => false,
    })
  }, [apply])
  const zoom = (scale: number) => apply(zoomImageAt(live.current.transform, scale, { x: bounds.width / 2, y: bounds.height / 2 }, bounds))
  return <View style={styles.container}>
    <View testID="image-zoom-viewport" style={styles.viewport} {...responder.panHandlers}
      onLayout={event => { const { width, height } = event.nativeEvent.layout; setViewport(old => old.width === width && old.height === height ? old : { width, height }) }}>
      <View pointerEvents="none">
      <Image source={{ uri }} resizeMode="contain" onError={onError}
        onLoad={event => { const { width, height } = event.nativeEvent.source; if (width > 0 && height > 0) { setNatural({ width, height }); apply(clampImageTransform(live.current.transform, { ...bounds, imageWidth: width * Math.min(bounds.width / width, bounds.height / height), imageHeight: height * Math.min(bounds.width / width, bounds.height / height) })) } }}
        style={{ width: bounds.imageWidth, height: bounds.imageHeight, transform: [{ translateX: transform.x }, { translateY: transform.y }, { scale: transform.scale }] }} />
      </View>
    </View>
    <View style={styles.controls}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('filePreview.zoomOut')} disabled={transform.scale <= 1} style={styles.button} onPress={() => zoom(transform.scale / 1.5)}><Text style={styles.label}>−</Text></TouchableOpacity>
      <Text style={styles.label}>{Math.round(transform.scale * 100)}%</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('filePreview.zoomIn')} disabled={transform.scale >= 8} style={styles.button} onPress={() => zoom(transform.scale * 1.5)}><Text style={styles.label}>＋</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => apply(FIT_IMAGE)}><Text style={styles.label}>{t('filePreview.fitImage')}</Text></TouchableOpacity>
    </View>
    <Text style={styles.hint}>{t('filePreview.zoomHint')}</Text>
  </View>
}
const styles = StyleSheet.create({
  container: { flex: 1 },
  viewport: { flex: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  label: { color: appColors.accent },
  hint: { color: appColors.textSecondary, textAlign: 'center', fontSize: 12, paddingBottom: 8 },
})
