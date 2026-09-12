import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Clipboard, Image, Linking, Modal, Text, TouchableOpacity } from 'react-native'
import { FilePreviewModal } from '../src/components/claude/FilePreviewModal'
import { RemoteImagePreview } from '../src/components/claude/RemoteImagePreview'
import { ToolCallCard } from '../src/components/claude/ToolCallCard'
import { MessageBubble } from '../src/components/claude/MessageBubble'
import type { ClaudeToolCall } from '../src/types'

// Exercise the real parser and render rules, not the global text-only mock.
jest.unmock('react-native-markdown-display')
const mockT = (key: string) => key
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }))
let mockChannels: any
jest.mock('../src/stores/connection-store', () => ({ useConnectionStore: (selector: any) => selector({ channels: mockChannels }) }))
const mockSave = jest.fn().mockResolvedValue(true)
jest.mock('../src/utils/file-export', () => ({ saveBase64File: (...args: any[]) => mockSave(...args) }))

const png = 'data:image/png;base64,aGVsbG8='
const tool: ClaudeToolCall = { id: 'image', sessionId: 's', toolName: 'image_view', input: { path: 'C:\\project\\pitcher-box.png' }, status: 'completed', timestamp: 1 }
let renderer: Renderer.ReactTestRenderer
beforeEach(() => {
  mockChannels = { fs: { readFile: jest.fn().mockResolvedValue({ content: 'hello' }), readImageAsDataUrl: jest.fn().mockResolvedValue(png) } }
  mockSave.mockClear()
})
afterEach(() => { if (renderer) act(() => renderer.unmount()); jest.restoreAllMocks() })

async function render(element: React.ReactElement) {
  await act(async () => { renderer = Renderer.create(element) })
}
async function pressButton(label: string) {
  const button = renderer.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label || node.findAllByType(Text).some(text => text.props.children === label))
  expect(button).toBeDefined()
  await act(async () => { button!.props.onPress() })
}
async function pressFirstLink() {
  await act(async () => { renderer.root.findAllByProps({ accessibilityRole: 'link' })[0].props.onPress() })
}

test('image_view reads the host image without expanding JSON, opens full preview and downloads it', async () => {
  await render(<ToolCallCard tool={tool} />)
  expect(mockChannels.fs.readImageAsDataUrl).toHaveBeenCalledWith('C:/project/pitcher-box.png')
  expect(renderer.root.findByType(Image).props.source.uri).toBe(png)
  await pressButton('filePreview.openImage')
  expect(renderer.root.findAllByType(Modal)).toHaveLength(1)
  await pressButton('workspaceDetail.button.download')
  expect(mockSave).toHaveBeenCalledWith('pitcher-box.png', png)
  expect(mockChannels.fs.readFile).not.toHaveBeenCalled()
})

test('does not fetch running tools and supports desktop inline results after completion', async () => {
  await render(<ToolCallCard tool={{ ...tool, status: 'running' }} />)
  expect(mockChannels.fs.readImageAsDataUrl).not.toHaveBeenCalled()
  await act(async () => { renderer.update(<ToolCallCard tool={{ ...tool, result: JSON.stringify({ type: 'image_generation', dataUrl: png }) }} />) })
  expect(renderer.root.findByType(Image).props.source.uri).toBe(png)
  expect(mockChannels.fs.readImageAsDataUrl).not.toHaveBeenCalled()
  await pressButton('filePreview.openImage')
  await pressButton('workspaceDetail.button.download')
  expect(mockSave).toHaveBeenCalledWith('image.png', png)
})

test('unavailable images show a retry and recover', async () => {
  mockChannels.fs.readImageAsDataUrl.mockRejectedValueOnce(new Error('File missing'))
  await render(<ToolCallCard tool={tool} />)
  expect(renderer.root.findAllByType(Image)).toHaveLength(0)
  expect(renderer.root.findAllByType(Text).some(text => String(text.props.children).includes('File missing'))).toBe(true)
  await pressButton('connection.retry')
  expect(renderer.root.findByType(Image).props.source.uri).toBe(png)
})

test('late responses from a previous path cannot overwrite the displayed image', async () => {
  let finish!: (data: string) => void
  mockChannels.fs.readImageAsDataUrl.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  await render(<RemoteImagePreview path="/old.png" />)
  await act(async () => { renderer.update(<RemoteImagePreview path="/new.png" />) })
  await act(async () => { finish('data:image/png;base64,b2xk') })
  expect(renderer.root.findByType(Image).props.source.uri).toBe(png)
})

test('Markdown links traverse multiple host previews and back within one native modal', async () => {
  const close = jest.fn()
  mockChannels.fs.readFile.mockImplementation(async (path: string) => ({ content: path.endsWith('root.md') ? '[next](next/second.md)' : '[image](../pitcher.png)' }))
  await render(<FilePreviewModal filePath="C:\\project\\docs\\root.md" visible onClose={close} />)
  await pressFirstLink()
  expect(mockChannels.fs.readFile).toHaveBeenLastCalledWith('C:/project/docs/next/second.md')
  expect(renderer.root.findAllByType(Modal)).toHaveLength(1)
  await pressFirstLink()
  expect(mockChannels.fs.readImageAsDataUrl).toHaveBeenLastCalledWith('C:/project/docs/pitcher.png')
  expect(renderer.root.findByType(Image).props.source.uri).toBe(png)
  await act(async () => { renderer.root.findByType(Modal).props.onRequestClose() })
  expect(mockChannels.fs.readFile).toHaveBeenLastCalledWith('C:/project/docs/next/second.md')
  await pressButton('filePreview.back')
  expect(mockChannels.fs.readFile).toHaveBeenLastCalledWith('C:/project/docs/root.md')
  expect(close).not.toHaveBeenCalled()
  await act(async () => { renderer.root.findByType(Modal).props.onRequestClose() })
  expect(close).toHaveBeenCalledTimes(1)
})

test('Markdown has source toggle and selectable copy, and inline local images open another page', async () => {
  const copy = jest.spyOn(Clipboard, 'setString').mockImplementation(() => {})
  const body = '# Read me\n\n![pitcher](../pitcher.png)'
  mockChannels.fs.readFile.mockResolvedValue({ content: body })
  await render(<FilePreviewModal filePath="/project/docs/root.md" visible onClose={jest.fn()} />)
  expect(mockChannels.fs.readImageAsDataUrl).toHaveBeenCalledWith('/project/pitcher.png')
  await pressButton('common.copy')
  expect(copy).toHaveBeenCalledWith(body)
  await pressButton('filePreview.source')
  expect(renderer.root.findAllByType(Text).some(text => text.props.children === body && text.props.selectable)).toBe(true)
  await pressButton('filePreview.rendered')
  await pressButton('filePreview.openImage')
  expect(renderer.root.findAllByType(Modal)).toHaveLength(1)
  expect(renderer.root.findAllByProps({ accessibilityLabel: 'filePreview.back' }).length).toBeGreaterThan(0)
})

test('chat Markdown uses session cwd and accepts file URLs, not the mobile filesystem', async () => {
  await render(<MessageBubble cwd="C:/project" message={{ id: 'm', sessionId: 's', role: 'assistant', content: '[file](docs/start.md)', timestamp: 1 }} />)
  await pressFirstLink()
  expect(mockChannels.fs.readFile).toHaveBeenCalledWith('C:/project/docs/start.md')
})

test('external Markdown links open externally without reading a host file', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
  mockChannels.fs.readFile.mockResolvedValue({ content: '[web](https://example.com/docs)' })
  await render(<FilePreviewModal filePath="/project/root.md" visible onClose={jest.fn()} />)
  await pressFirstLink()
  expect(open).toHaveBeenCalledWith('https://example.com/docs')
  expect(mockChannels.fs.readFile).toHaveBeenCalledTimes(1)
})

test('downloads original bytes even when the text preview fails', async () => {
  mockChannels.fs.readFile.mockResolvedValue({ error: 'File too large' })
  await render(<FilePreviewModal filePath="/project/big.txt" visible onClose={jest.fn()} />)
  await pressButton('workspaceDetail.button.download')
  expect(mockSave).toHaveBeenCalledWith('big.txt', png)
})

test('a profile change discards its old in-flight file response', async () => {
  let finish!: (data: { content: string }) => void
  mockChannels.fs.readFile.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  await render(<FilePreviewModal filePath="/project/file.txt" visible onClose={jest.fn()} />)
  mockChannels = { fs: { readFile: jest.fn().mockResolvedValue({ content: 'new profile' }) } }
  await act(async () => { renderer.update(<FilePreviewModal filePath="/project/file.txt" visible onClose={jest.fn()} />) })
  await act(async () => { finish({ content: 'old profile' }) })
  expect(renderer.root.findAllByType(Text).some(text => text.props.children === 'new profile')).toBe(true)
  expect(renderer.root.findAllByType(Text).some(text => text.props.children === 'old profile')).toBe(false)
})
