/**
 * LinkedText - Renders text with tappable file paths
 * Mobile equivalent of BAT Desktop's LinkedText in PathLinker.tsx
 */

import React, { useContext, useState, useMemo } from 'react'
import { Alert, Image, Linking, StyleSheet, Text, TouchableOpacity, type TextStyle } from 'react-native'
import type { RenderFunction, RenderRules } from 'react-native-markdown-display'
import { tokenizePaths } from '@/utils/path-tokenizer'
import { FilePreviewModal } from './FilePreviewModal'
import { PreviewNavigation } from './PreviewNavigation'
import { RemoteImagePreview } from './RemoteImagePreview'
import { resolveHostPath, resolvePreviewLink } from '@/utils/file-preview'

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
  const navigate = useContext(PreviewNavigation)

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
              onPress={() => {
                const path = resolveHostPath(token.text)
                if (path) (navigate || setPreviewPath)(path)
              }}
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
const selectableRules: RenderRules = {
  textgroup: (node, children, _parent, styles) => (
    <Text key={node.key} style={styles.textgroup} selectable>
      {children}
    </Text>
  ),
  code_block: selectableCodeBlock,
  fence: selectableCodeBlock,
  text: (node, _children, parents, styles) => parents.some(parent => parent.type === 'link' || parent.type === 'blocklink')
    ? <Text key={node.key}>{node.content}</Text>
    : <LinkedText key={node.key} text={node.content} style={{ ...styles?.body, ...styles?.text }} />,
}

function PreviewLink({ href, directory, children, style, block = false }: {
  href: string; directory?: string; children: React.ReactNode; style?: TextStyle; block?: boolean
}) {
  const navigate = useContext(PreviewNavigation)
  const [path, setPath] = useState<string | null>(null)
  const open = () => {
    const target = resolvePreviewLink(href, directory)
    if (target?.kind === 'file') (navigate || setPath)(target.path)
    else if (target?.kind === 'external') Linking.openURL(target.url).catch(error => Alert.alert(String(error)))
  }
  return <>
    {block ? <TouchableOpacity accessibilityRole="link" onPress={open}>{children}</TouchableOpacity> : <Text accessibilityRole="link" style={style || pathStyle} onPress={open}>{children}</Text>}
    {path && <FilePreviewModal filePath={path} visible onClose={() => setPath(null)} />}
  </>
}

export function createPathLinkerRules(directory?: string): RenderRules {
  return {
    ...selectableRules,
    link: (node, children, _parent, styles) => <PreviewLink key={node.key} href={node.attributes.href} directory={directory} style={styles.link}>{children}</PreviewLink>,
    blocklink: (node, children) => <PreviewLink key={node.key} href={node.attributes.href} directory={directory} block>{children}</PreviewLink>,
    image: (node) => {
      const src = node.attributes.src || ''
      const target = resolvePreviewLink(src, directory)
      if (target?.kind === 'file') return <RemoteImagePreview key={node.key} path={target.path} />
      if (/^data:image\//.test(src)) return <RemoteImagePreview key={node.key} dataUrl={src} />
      if (target?.kind === 'external' && /^https?:/.test(target.url)) return <Image key={node.key} source={{ uri: target.url }} style={styles.remoteImage} resizeMode="contain" />
      return <Text key={node.key}>{node.content || src}</Text>
    },
  }
}

export const pathLinkerRules = createPathLinkerRules()

const styles = StyleSheet.create({ remoteImage: { width: '100%', height: 220 } })
