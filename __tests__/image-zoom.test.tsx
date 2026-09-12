import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Image, PanResponder, TouchableOpacity } from 'react-native'
import { ZoomableImage } from '../src/components/claude/ZoomableImage'
import { clampImageTransform, FIT_IMAGE, moveImageGesture, zoomImageAt } from '../src/utils/image-zoom'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const bounds = { width: 300, height: 300, imageWidth: 300, imageHeight: 300 }
test('pinch keeps the touched content under the fingers while zooming and panning', () => {
  expect(moveImageGesture(FIT_IMAGE, [{ x: 50, y: 100 }, { x: 150, y: 100 }], [{ x: 10, y: 120 }, { x: 210, y: 120 }], bounds))
    .toEqual({ scale: 2, x: 60, y: 70 })
})
test('one finger pans only within the image bounds and fit mode never drifts', () => {
  expect(moveImageGesture({ scale: 2, x: 0, y: 0 }, [{ x: 0, y: 0 }], [{ x: 999, y: -999 }], bounds)).toEqual({ scale: 2, x: 150, y: -150 })
  expect(moveImageGesture(FIT_IMAGE, [{ x: 0, y: 0 }], [{ x: 100, y: 100 }], bounds)).toEqual(FIT_IMAGE)
})
test('wide images cannot pan vertically until the actual image fills the viewport', () => {
  expect(clampImageTransform({ scale: 2, x: 100, y: 100 }, { ...bounds, imageHeight: 100 })).toEqual({ scale: 2, x: 100, y: 0 })
})
test('zoom is limited to fit through 8x, and zooming out recentres the image', () => {
  expect(zoomImageAt(FIT_IMAGE, 100, { x: 150, y: 150 }, bounds).scale).toBe(8)
  expect(zoomImageAt({ scale: 5, x: 300, y: 300 }, 0.1, { x: 20, y: 20 }, bounds)).toEqual(FIT_IMAGE)
})
test('finger-count changes and coincident fingers do not create jumps or invalid values', () => {
  expect(moveImageGesture(FIT_IMAGE, [], [], bounds)).toEqual(FIT_IMAGE)
  expect(moveImageGesture(FIT_IMAGE, [{ x: 1, y: 1 }], [{ x: 0, y: 0 }, { x: 2, y: 2 }], bounds)).toEqual(FIT_IMAGE)
  expect(moveImageGesture(FIT_IMAGE, [{ x: 1, y: 1 }, { x: 1, y: 1 }], [{ x: 0, y: 0 }, { x: 2, y: 2 }], bounds)).toEqual(FIT_IMAGE)
})

test('zoom buttons, fit and changing images reset the rendered transform', () => {
  let renderer!: Renderer.ReactTestRenderer
  act(() => { renderer = Renderer.create(<ZoomableImage uri="data:image/png;base64,aA==" />) })
  const press = (label: string) => act(() => renderer.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label || node.findAllByProps({ children: label }).length > 0)!.props.onPress())
  act(() => renderer.root.findByProps({ testID: 'image-zoom-viewport' }).props.onLayout({ nativeEvent: { layout: { width: 300, height: 400 } } }))
  act(() => renderer.root.findByType(Image).props.onLoad({ nativeEvent: { source: { width: 600, height: 800 } } }))
  press('filePreview.zoomIn')
  expect(renderer.root.findByType(Image).props.style.transform[2].scale).toBe(1.5)
  press('filePreview.zoomOut')
  expect(renderer.root.findByType(Image).props.style.transform[2].scale).toBe(1)
  press('filePreview.zoomIn')
  press('filePreview.fitImage')
  expect(renderer.root.findByType(Image).props.style.transform[2].scale).toBe(1)
  press('filePreview.zoomIn')
  act(() => { renderer.update(<ZoomableImage uri="data:image/png;base64,bg==" />) })
  expect(renderer.root.findByType(Image).props.style.transform[2].scale).toBe(1)
  act(() => renderer.unmount())
})

test('touch handlers support pinch, one-finger continuation and double-tap reset', () => {
  const spy = jest.spyOn(PanResponder, 'create')
  let renderer!: Renderer.ReactTestRenderer
  act(() => { renderer = Renderer.create(<ZoomableImage uri="data:image/png;base64,aA==" />) })
  const handlers = spy.mock.calls[0][0]
  const touches = (points: number[][]) => ({ nativeEvent: { touches: points.map(([x, y]) => ({ locationX: x, locationY: y })) } } as any)
  act(() => renderer.root.findByProps({ testID: 'image-zoom-viewport' }).props.onLayout({ nativeEvent: { layout: { width: 300, height: 300 } } }))
  act(() => handlers.onPanResponderGrant!(touches([[100, 150], [200, 150]]), {} as any))
  act(() => handlers.onPanResponderMove!(touches([[50, 150], [250, 150]]), {} as any))
  expect(renderer.root.findByType(Image).props.style.transform[2].scale).toBe(2)
  // Lifting one finger rebases the gesture, then the remaining finger pans.
  act(() => handlers.onPanResponderMove!(touches([[100, 150]]), {} as any))
  act(() => handlers.onPanResponderMove!(touches([[120, 150]]), {} as any))
  expect(renderer.root.findByType(Image).props.style.transform[0].translateX).toBe(20)
  act(() => handlers.onPanResponderRelease!(touches([]), {} as any))
  for (let i = 0; i < 2; i++) {
    act(() => handlers.onPanResponderGrant!(touches([[150, 150]]), {} as any))
    act(() => handlers.onPanResponderRelease!(touches([]), {} as any))
  }
  expect(renderer.root.findByType(Image).props.style.transform[2].scale).toBe(1)
  act(() => renderer.unmount())
  spy.mockRestore()
})
