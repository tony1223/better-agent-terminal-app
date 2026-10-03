import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { FlatList, Text, TextInput } from 'react-native'
import { FilesPane } from '../src/screens/WorkspaceDetailScreen'
import { FilePreviewModal } from '../src/components/claude/FilePreviewModal'
import { useConnectionStore } from '../src/stores/connection-store'

const mockT = (key: string) => key
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }))
jest.mock('../src/components/claude/FilePreviewModal', () => ({ FilePreviewModal: () => null }))

const root = 'D:\\repo'
const directory = { name: 'src', path: `${root}\\src`, isDirectory: true }
const result = { name: 'main.ts', path: `${root}\\src\\main.ts`, isDirectory: false }
let renderer: Renderer.ReactTestRenderer
let fs: { readdir: jest.Mock; search: jest.Mock }
const input = () => renderer.root.findByType(TextInput)
const list = () => renderer.root.findByType(FlatList)
const data = () => list().props.data
async function enterQuery(query: string) {
  act(() => input().props.onChangeText(query))
  await act(async () => { await jest.advanceTimersByTimeAsync(250) })
}
async function mount(active = true) {
  await act(async () => { renderer = Renderer.create(<FilesPane rootPath={root} active={active} />) })
}
beforeEach(() => {
  jest.useFakeTimers()
  fs = { readdir: jest.fn().mockResolvedValue([directory]), search: jest.fn().mockResolvedValue([result]) }
  useConnectionStore.setState({ channels: { fs } as never })
})
afterEach(() => {
  act(() => renderer?.unmount())
  jest.useRealTimers()
})

test('searches the host recursively after typing settles, opens a result, and clears back to browsing', async () => {
  await mount()
  expect(fs.readdir).toHaveBeenCalledWith(root)
  expect(data()).toEqual([directory])
  act(() => input().props.onChangeText('m'))
  await act(async () => { await jest.advanceTimersByTimeAsync(100) })
  act(() => input().props.onChangeText('main'))
  expect(fs.search).not.toHaveBeenCalled()
  await act(async () => { await jest.advanceTimersByTimeAsync(250) })
  expect(fs.search).toHaveBeenCalledTimes(1)
  expect(fs.search).toHaveBeenCalledWith(root, 'main')
  expect(data()).toEqual([result])
  act(() => list().props.renderItem({ item: result }).props.onPress())
  expect(renderer.root.findByType(FilePreviewModal).props.filePath).toBe(result.path)
  await act(async () => renderer.root.findByProps({ testID: 'file-search-clear' }).props.onPress())
  expect(input().props.value).toBe('')
  expect(data()).toEqual([directory])
  expect(fs.readdir).toHaveBeenCalledTimes(2)
})

test('opening a matching folder clears the search and browses that folder', async () => {
  fs.search.mockResolvedValue([{ ...directory, isDirectory: undefined, is_directory: true }])
  await mount()
  await enterQuery('src')
  expect(data()[0].isDirectory).toBe(true)
  await act(async () => list().props.renderItem({ item: data()[0] }).props.onPress())
  expect(input().props.value).toBe('')
  expect(fs.readdir).toHaveBeenLastCalledWith(directory.path)
})

test('late search replies cannot replace a newer query or a cleared directory listing', async () => {
  let finishOld!: (entries: unknown[]) => void
  let finishNew!: (entries: unknown[]) => void
  fs.search.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
  fs.search.mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve }))
  await mount()
  await enterQuery('old')
  await enterQuery('new')
  await act(async () => { finishOld([{ ...result, name: 'old.ts' }]) })
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'old.ts')).toBe(false)
  await act(async () => renderer.root.findByProps({ testID: 'file-search-clear' }).props.onPress())
  await act(async () => { finishNew([result]) })
  expect(data()).toEqual([directory])
})

test('whitespace edits do not invalidate an in-flight query with the same trimmed text', async () => {
  let finish!: (entries: unknown[]) => void
  fs.search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await mount()
  await enterQuery('main')
  act(() => input().props.onChangeText('main '))
  await act(async () => { finish([result]) })
  expect(data()).toEqual([result])
  expect(fs.search).toHaveBeenCalledTimes(1)
})

test('hidden tabs cancel pending searches, resume on return, and discard old profile responses', async () => {
  await mount(false)
  expect(fs.readdir).not.toHaveBeenCalled()
  await act(async () => renderer.update(<FilesPane rootPath={root} active />))
  act(() => input().props.onChangeText('main'))
  act(() => renderer.update(<FilesPane rootPath={root} active={false} />))
  await act(async () => { await jest.advanceTimersByTimeAsync(250) })
  expect(fs.search).not.toHaveBeenCalled()
  await act(async () => renderer.update(<FilesPane rootPath={root} active />))
  let finish!: (entries: unknown[]) => void
  fs.search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => { await jest.advanceTimersByTimeAsync(250) })
  const nextFs = { readdir: jest.fn(), search: jest.fn().mockResolvedValue([{ ...result, name: 'new-profile.ts' }]) }
  act(() => useConnectionStore.setState({ channels: { fs: nextFs } as never }))
  await act(async () => { finish([result]); await jest.advanceTimersByTimeAsync(250) })
  expect(data()[0].name).toBe('new-profile.ts')
})

test('no matches and search failures give feedback and can be retried by refreshing', async () => {
  await mount()
  fs.search.mockResolvedValueOnce([])
  await enterQuery('none')
  expect(list().props.ListEmptyComponent.props.title).toBe('workspaceDetail.files.noResults')
  fs.search.mockRejectedValueOnce(new Error('offline'))
  await enterQuery('main')
  expect(list().props.ListEmptyComponent.props.body).toContain('offline')
  await act(async () => { await list().props.refreshControl.props.onRefresh() })
  expect(fs.search).toHaveBeenLastCalledWith(root, 'main')
  expect(data()).toEqual([result])
})
