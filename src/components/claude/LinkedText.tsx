/**
 * LinkedText - Renders text with tappable file paths
 * Mobile equivalent of BAT Desktop's LinkedText in PathLinker.tsx
 */

import React, { useState, useMemo } from 'react'
import { Text, type TextStyle } from 'react-native'
import { tokenizePaths, hasPaths } from '@/utils/path-tokenizer'
import { FilePreviewModal } from './FilePreviewModal'
import { appColors } from '@/theme/colors'

interface Props {
  text: string
  style?: TextStyle
}

const pathStyle: TextStyle = {
  color: '#e0a870',
  textDecorationLine: 'underline',
  textDecorationStyle: 'dotted',
}

export function LinkedText({ text, style }: Props) {
  const [previewPath, setPreviewPath] = useState<string | null>(null)

  const tokens = useMemo(() => tokenizePaths(text), [text])
  const hasPathTokens = tokens.length > 1 || tokens[0]?.type === 'path'

  if (!hasPathTokens) {
    return <Text style={style}>{text}</Text>
  }

  return (
    <>
      <Text style={style}>
        {tokens.map((token, i) =>
          token.type === 'path' ? (
            <Text
              key={i}
              style={pathStyle}
              onPress={() => setPreviewPath(token.text)}
            >
              {token.text}
            </Text>
          ) : (
            <Text key={i}>{token.text}</Text>
          ),
        )}
      </Text>
      {previewPath && (
        <FilePreviewModal
          filePath={previewPath}
          visible
          onClose={() => setPreviewPath(null)}
        />
      )}
    </>
  )
}

/**
 * Custom rules for react-native-markdown-display
 * Replaces default text renderer with LinkedText to detect file paths
 */
export const pathLinkerRules = {
  text: (node: any, _children: any, _parent: any, styles: any) => (
    <LinkedText key={node.key} text={node.content} style={styles?.text} />
  ),
}
