export interface ZoomTransform { scale: number; x: number; y: number }
export interface Point { x: number; y: number }
export interface ImageBounds { width: number; height: number; imageWidth: number; imageHeight: number }
export const FIT_IMAGE: ZoomTransform = { scale: 1, x: 0, y: 0 }

export function clampImageTransform(transform: ZoomTransform, bounds: ImageBounds): ZoomTransform {
  const scale = Math.min(8, Math.max(1, transform.scale))
  const maxX = Math.max(0, (bounds.imageWidth * scale - bounds.width) / 2)
  const maxY = Math.max(0, (bounds.imageHeight * scale - bounds.height) / 2)
  return { scale, x: maxX ? Math.max(-maxX, Math.min(maxX, transform.x)) : 0, y: maxY ? Math.max(-maxY, Math.min(maxY, transform.y)) : 0 }
}

/** Scale about the touched point rather than moving it to the image centre. */
export function zoomImageAt(start: ZoomTransform, scale: number, point: Point, bounds: ImageBounds): ZoomTransform {
  scale = Math.max(1, Math.min(8, scale))
  const ratio = scale / start.scale
  const x = point.x - bounds.width / 2
  const y = point.y - bounds.height / 2
  return clampImageTransform({ scale, x: x - (x - start.x) * ratio, y: y - (y - start.y) * ratio }, bounds)
}

export function moveImageGesture(start: ZoomTransform, from: Point[], to: Point[], bounds: ImageBounds): ZoomTransform {
  if (!from.length || !to.length || from.length !== to.length) return start
  if (from.length === 1) return clampImageTransform({ ...start, x: start.x + to[0].x - from[0].x, y: start.y + to[0].y - from[0].y }, bounds)
  const middle = (points: Point[]) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 })
  const distance = (points: Point[]) => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
  const initialDistance = distance(from)
  if (initialDistance < 1) return start
  const before = middle(from)
  const after = middle(to)
  const scale = Math.max(1, Math.min(8, start.scale * distance(to) / initialDistance))
  const ratio = scale / start.scale
  // Clamp once after applying both pinch and translation, so a moving focal
  // point does not accumulate edge-clamping errors during a two-finger pan.
  return clampImageTransform({ scale,
    x: after.x - bounds.width / 2 - (before.x - bounds.width / 2 - start.x) * ratio,
    y: after.y - bounds.height / 2 - (before.y - bounds.height / 2 - start.y) * ratio,
  }, bounds)
}
