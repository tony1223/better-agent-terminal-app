import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Modal, Text, TextInput, TouchableOpacity } from 'react-native'
import { SessionRenameButton } from '../src/components/session/SessionRenameButton'
import { SessionHeaderTitle } from '../src/components/session/SessionHeaderTitle'
import { useWorkspaceStore } from '../src/stores/workspace-store'
import type { TerminalInstance } from '../src/types'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const terminal = { id: 's', workspaceId: 'w', title: 'Codex Agent', alias: 'Release job' } as TerminalInstance
let renderer: Renderer.ReactTestRenderer
const labels = () => renderer.root.findAllByType(Text).map(node => node.props.children)
const button = (label: string) => renderer.root.findAllByType(TouchableOpacity)
  .find(node => node.findAllByType(Text).some(text => text.props.children === label))!
beforeEach(() => {
  useWorkspaceStore.setState({ terminals: [terminal], workspaces: [{ id: 'w', name: 'bbo_platform', folderPath: '/', createdAt: 0 }] })
})
afterEach(() => { act(() => renderer?.unmount()); jest.restoreAllMocks() })

test('rename dialog edits the current alias, saves once, and closes after confirmation', async () => {
  const rename = jest.spyOn(useWorkspaceStore.getState(), 'renameSession').mockResolvedValue()
  act(() => { renderer = Renderer.create(<SessionRenameButton terminal={terminal} />) })
  act(() => button('session.rename.button').props.onPress())
  expect(renderer.root.findByType(TextInput).props.value).toBe('Release job')
  act(() => renderer.root.findByType(TextInput).props.onChangeText('Build verification'))
  await act(async () => {
    button('common.save').props.onPress()
    button('common.save').props.onPress()
  })
  expect(rename).toHaveBeenCalledTimes(1)
  expect(rename).toHaveBeenCalledWith('s', 'Build verification')
  expect(renderer.root.findByType(Modal).props.visible).toBe(false)
})

test('blank input cannot save and failures keep the entered name for retry', async () => {
  jest.spyOn(useWorkspaceStore.getState(), 'renameSession').mockRejectedValue(new Error('offline'))
  act(() => { renderer = Renderer.create(<SessionRenameButton terminal={terminal} />) })
  act(() => button('session.rename.button').props.onPress())
  act(() => renderer.root.findByType(TextInput).props.onChangeText('   '))
  expect(button('common.save').props.disabled).toBe(true)
  act(() => renderer.root.findByType(TextInput).props.onChangeText('Retry name'))
  await act(async () => { await button('common.save').props.onPress() })
  expect(renderer.root.findByType(Modal).props.visible).toBe(true)
  expect(renderer.root.findByType(TextInput).props.value).toBe('Retry name')
  expect(labels()).toContain('session.rename.failed')
})

test('chat header shows the alias first and updates after desktop reload; no alias falls back to title', () => {
  act(() => { renderer = Renderer.create(<SessionHeaderTitle sessionId="s" />) })
  expect(labels().slice(0, 2)).toEqual(['Release job', 'bbo_platform'])
  act(() => useWorkspaceStore.setState({ terminals: [{ ...terminal, alias: 'Server deploy' }] }))
  expect(labels()[0]).toBe('Server deploy')
  act(() => useWorkspaceStore.setState({ terminals: [{ ...terminal, alias: undefined }] }))
  expect(labels()[0]).toBe('Codex Agent')
  expect(renderer.root.findAllByType(TouchableOpacity).some(node => node.props.accessibilityLabel === 'session.rename.title')).toBe(true)
})
