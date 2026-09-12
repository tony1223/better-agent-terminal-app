import type { ClaudeToolCall } from '@/types'
import { getFileExt } from './path-tokenizer'

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'])
export const isMarkdownFile = (path: string) => ['md', 'markdown', 'mdown'].includes(getFileExt(path))

export type PreviewLinkTarget =
  | { kind: 'file'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'fragment'; fragment: string }

export function fileDirectory(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/[^/]*$/, '') || '/'
}

/** Tool inputs / filesystem entries are paths, not URLs: # and % are literal. */
export function resolveHostPath(path: string, directory?: string): string | null {
  const normalized = path.replace(/\\/g, '/')
  const href = encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F')
  const target = resolvePreviewLink(normalized.startsWith('//') ? `file:${href}` : href, directory)
  return target?.kind === 'file' ? target.path : null
}

/** Resolve against the host document/cwd, never the phone's filesystem. */
export function resolvePreviewLink(href: string, directory?: string): PreviewLinkTarget | null {
  let path = href.trim()
  if (!path) return null
  if (path.startsWith('#')) return { kind: 'fragment', fragment: path.slice(1) }
  if (/^(https?|mailto|tel|ftps?):/i.test(path)) return { kind: 'external', url: path }
  if (path.startsWith('//')) return { kind: 'external', url: `https:${path}` }
  const fileUrl = /^file:\/\//i.test(path)
  if (!fileUrl && !/^[A-Za-z]:[\\/]/.test(path) && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return null
  path = path.split(/[?#]/)[0]
  try { path = decodeURIComponent(path) } catch { /* Preserve literal percent signs in host paths. */ }
  if (fileUrl) {
    path = path.replace(/^file:\/\/(localhost)?/i, '')
    if (!path.startsWith('/')) path = `//${path}`
    path = path.replace(/^\/([A-Za-z]:\/)/, '$1')
  }
  path = path.replace(/\\/g, '/').replace(/(\.[A-Za-z0-9]{1,10}):\d+(?::\d+)?$/, '$1')
  if (!path.startsWith('/') && !/^[A-Za-z]:\//.test(path)) {
    if (!directory) return null
    path = `${directory.replace(/\\/g, '/')}/${path}`
  }
  const root = path.match(/^(?:[A-Za-z]:\/|\/\/[^/]+\/[^/]+\/?|\/)/)?.[0]
  if (!root) return null
  const parts: string[] = []
  for (const part of path.slice(root.length).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return { kind: 'file', path: root.replace(/\/?$/, '/') + parts.join('/') }
}

export interface ToolImage { path?: string; dataUrl?: string }

/** Same image_generation result envelope used by the desktop image cards. */
export function toolPreviewImage(tool: ClaudeToolCall, cwd?: string): ToolImage | null {
  const name = tool.toolName.split('.').pop()
  if (!['image_view', 'view_image', 'image_gen'].includes(name || '') || tool.denied || tool.status !== 'completed') return null
  try {
    const result = JSON.parse(tool.result || 'null')
    if (result?.type === 'image_generation') {
      if (typeof result.dataUrl === 'string' && result.dataUrl.startsWith('data:image/')) {
        return { dataUrl: result.dataUrl }
      }
      if (typeof result.path === 'string') {
        const path = resolveHostPath(result.path, cwd)
        if (path) return { path }
      }
    }
  } catch { /* Older history may contain only the tool input path. */ }
  if (name === 'image_gen') return null
  const path = tool.input.path ?? tool.input.file_path
  const resolved = typeof path === 'string' ? resolveHostPath(path, cwd) : null
  return resolved ? { path: resolved } : null
}
