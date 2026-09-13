/**
 * Path Tokenizer - detects absolute file paths in text
 * Ported from BAT Desktop PathLinker.tsx
 */

const PATH_RE =
  /(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|opt|etc|usr|mnt|srv|root)\/)[\w\-. \\/]+\.\w{1,10}/g

// URL text can otherwise look like a Windows drive (the s:/ in https://)
// or contain an absolute Unix path. Protect URLs even in non-Markdown text.
const URI_RE = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"'`]+/g

export type TokenType = 'text' | 'path'
export interface Token {
  type: TokenType
  text: string
}

/** Tokenize text into interleaved text/path segments */
export function tokenizePaths(text: string): Token[] {
  PATH_RE.lastIndex = 0
  const urls = Array.from(text.matchAll(URI_RE), match => ({ start: match.index!, end: match.index! + match[0].length }))
  const tokens: Token[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = PATH_RE.exec(text)) !== null) {
    if (urls.some(url => match!.index < url.end && PATH_RE.lastIndex > url.start)) continue
    // A drive letter must not be the tail of an identifier or URI scheme.
    if (match.index > 0 && /[\w]/.test(text[match.index - 1])) continue
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    }
    tokens.push({ type: 'path', text: match[0] })
    lastIndex = PATH_RE.lastIndex
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', text: text.slice(lastIndex) })
  }

  return tokens.length > 0 ? tokens : [{ type: 'text', text }]
}

/** Use the same URL exclusions as the renderer. */
export function hasPaths(text: string): boolean {
  return tokenizePaths(text).some(token => token.type === 'path')
}

/** Get filename from a path */
export function getFileName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}

/** Get file extension (lowercase, no dot) */
export function getFileExt(filePath: string): string {
  const name = getFileName(filePath)
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}
