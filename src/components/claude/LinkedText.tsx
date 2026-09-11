/**
 * LinkedText - Renders text with tappable file paths
 * Mobile equivalent of BAT Desktop's LinkedText in PathLinker.tsx
 */

import React, { useState, useMemo } from 'react'
import { Text, type TextStyle } from 'react-native'
import type { RenderFunction, RenderRules } from 'react-native-markdown-display'
import { tokenizePaths } from '@/utils/path-tokenizer'
import { FilePreviewModal } from './FilePreviewModal'

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
    return <Text style={style} selectable>{text}</Text>
  }

  return (
    <>
      <Text style={style} selectable>
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

const selectableCodeBlock: RenderFunction = (node, _children, _parent, styles, inheritedStyles = {}) => (
  <Text key={node.key} style={[inheritedStyles, styles[node.type]]} selectable>
    {node.content.replace(/\n$/, '')}
  </Text>
)

/**
 * Shared by completed and streaming messages. Selection must be enabled on
 * the outer Text that owns each paragraph, heading, list item or table cell;
 * selectable nested LinkedText nodes alone cannot enable native selection.
 */
export const pathLinkerRules: RenderRules = {
  textgroup: (node, children, _parent, styles) => (
    <Text key={node.key} style={styles.textgroup} selectable>
      {children}
    </Text>
  ),
  code_block: selectableCodeBlock,
  fence: selectableCodeBlock,
  text: (node: any, _children: any, _parent: any, styles: any) => (
    <LinkedText key={node.key} text={node.content} style={{ ...styles?.body, ...styles?.text }} />
  ),
}
