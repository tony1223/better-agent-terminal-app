/* eslint-disable no-script-url -- Adversarial URLs verify the preview's protocol allowlist. */
import { fileDirectory, resolveHostPath, resolvePreviewLink, toolPreviewImage } from '../src/utils/file-preview'
import { hostMarkdown } from '../src/utils/host-markdown'
import type { ClaudeToolCall } from '../src/types'

describe('host preview paths', () => {
  it.each([
    ['next.md', 'C:/project/docs', 'C:/project/docs/next.md'],
    ['../images/pitcher.png', 'C:\\project\\docs', 'C:/project/images/pitcher.png'],
    ['./next.md', '/project/docs', '/project/docs/next.md'],
    ['../../next.md', '/project/docs', '/next.md'],
    ['../../../next.md', '/project', '/next.md'],
    ['C:\\workspaces\\遊戲\\pitcher-box.png', undefined, 'C:/workspaces/遊戲/pitcher-box.png'],
    ['/project/a.png', undefined, '/project/a.png'],
    ['file:///C:/project/a%20b.png', undefined, 'C:/project/a b.png'],
    ['file:///home/user/a.png', undefined, '/home/user/a.png'],
    ['file://localhost/home/user/a.png', undefined, '/home/user/a.png'],
    ['file://server/share/a.png', undefined, '//server/share/a.png'],
    ['\\\\server\\share\\docs\\..\\a.png', undefined, '//server/share/a.png'],
    ['../程式.ts:42:7', 'C:/project/docs', 'C:/project/程式.ts'],
    ['next.md#section', '/project/docs', '/project/docs/next.md'],
    ['a%23b.md', '/project/docs', '/project/docs/a#b.md'],
  ])('resolves %s on the host', (href, directory, path) => {
    expect(resolvePreviewLink(href!, directory)).toEqual({ kind: 'file', path })
  })

  it.each(['javascript:alert(1)', 'data:text/html,bad', 'content://private/file', 'vbscript:bad', '', 'relative.md'])('does not open unsafe or unresolved links: %s', href => {
    expect(resolvePreviewLink(href)).toBeNull()
  })

  it('keeps external URLs separate from host files and recognises fragments', () => {
    expect(resolvePreviewLink('https://example.com/a?q=x#h')).toEqual({ kind: 'external', url: 'https://example.com/a?q=x#h' })
    expect(resolvePreviewLink('//example.com/a')).toEqual({ kind: 'external', url: 'https://example.com/a' })
    expect(resolvePreviewLink('#section')).toEqual({ kind: 'fragment', fragment: 'section' })
    expect(fileDirectory('/README.md')).toBe('/')
  })

  it('preserves literal hashes and percent escapes in filesystem/tool paths', () => {
    expect(resolveHostPath('C:\\project\\a#b%20.png')).toBe('C:/project/a#b%20.png')
    expect(resolveHostPath('\\\\server\\share\\a#b.png')).toBe('//server/share/a#b.png')
  })

  it('allows file links in the actual Markdown parser without allowing active content', () => {
    const tokens = hostMarkdown.parse('[file](file:///C:/project/a.md)', {})
    expect(tokens[1].children?.some((token: { type: string }) => token.type === 'link_open')).toBe(true)
    expect(hostMarkdown.validateLink('javascript:alert(1)')).toBe(false)
    expect(hostMarkdown.validateLink('data:text/html,test')).toBe(false)
  })
})

describe('desktop image tool result compatibility', () => {
  const tool: ClaudeToolCall = { id: 'i', sessionId: 's', timestamp: 1, toolName: 'image_view', status: 'completed', input: { path: 'C:\\project\\image.png' } }
  it('supports input-only history and view_image aliases', () => {
    expect(toolPreviewImage(tool)).toEqual({ path: 'C:/project/image.png' })
    expect(toolPreviewImage({ ...tool, toolName: 'functions.view_image', input: { path: 'image.png' } }, '/project')).toEqual({ path: '/project/image.png' })
  })
  it('supports the desktop image_generation path and inline envelopes', () => {
    expect(toolPreviewImage({ ...tool, result: JSON.stringify({ type: 'image_generation', path: '/generated.png' }) })).toEqual({ path: '/generated.png' })
    expect(toolPreviewImage({ ...tool, toolName: 'image_gen', result: JSON.stringify({ type: 'image_generation', dataUrl: 'data:image/png;base64,abc' }) })).toEqual({ dataUrl: 'data:image/png;base64,abc' })
  })
  it('does not read images for unfinished, failed, denied or unrelated tools', () => {
    expect(toolPreviewImage({ ...tool, status: 'running' })).toBeNull()
    expect(toolPreviewImage({ ...tool, status: 'error' })).toBeNull()
    expect(toolPreviewImage({ ...tool, denied: true })).toBeNull()
    expect(toolPreviewImage({ ...tool, toolName: 'read_file' })).toBeNull()
    expect(toolPreviewImage({ ...tool, toolName: 'image_gen' })).toBeNull()
  })
})
