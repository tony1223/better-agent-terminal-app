/**
 * Path Tokenizer - detects absolute file paths in text
 * Ported from BAT Desktop PathLinker.tsx
 */

const PATH_RE =
  /(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|opt|etc|usr|mnt|srv|root)\/)[\w\-. \\/]+\.\w{1,10}/g

export type TokenType = 'text' | 'path'
export interface Token {
  type: TokenType
  text: string
}

/** Tokenize text into interleaved text/path segments */
export function tokenizePaths(text: string): Token[] {
  PATH_RE.lastIndex = 0
  const tokens: Token[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = PATH_RE.exec(text)) !== null) {
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

/** Check if tokenizePaths would find any paths (fast check) */
export function hasPaths(text: string): boolean {
  PATH_RE.lastIndex = 0
  return PATH_RE.test(text)
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
