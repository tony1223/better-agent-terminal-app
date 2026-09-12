import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Keyboard, TextInput, TouchableOpacity } from 'react-native'
import { SessionWorkspaceTabs } from '../src/components/session/SessionWorkspaceTabs'
import { FilesPane, GitPane } from '../src/screens/WorkspaceDetailScreen'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (effect: any) => require('react').useEffect(effect, [effect]) }))
jest.mock('../src/screens/WorkspaceDetailScreen', () => {
  const ReactMock = require('react')
  const { View } = require('react-native')
  return {
    FilesPane: () => ReactMock.createElement(View, { testID: 'files-content' }),
    GitPane: () => ReactMock.createElement(View, { testID: 'git-content' }),
  }
})
let renderer: Renderer.ReactTestRenderer
const element = (cwd?: string) => <SessionWorkspaceTabs sessionId="test" cwd={cwd}><TextInput defaultValue="draft not yet sent" /></SessionWorkspaceTabs>
const press = (index: number) => act(() => renderer.root.findAllByType(TouchableOpacity).filter(node => node.props.accessibilityRole === 'tab')[index].props.onPress())
afterEach(() => { act(() => renderer?.unmount()); jest.restoreAllMocks() })

test('switches locally, preserves the chat and visited tools, and uses session cwd', () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {})
  act(() => { renderer = Renderer.create(element('/repo/worktrees/fix')) })
  const chat = renderer.root.findByType(TextInput).instance
  expect(renderer.root.findAllByType(FilesPane)).toHaveLength(0)
  expect(renderer.root.findAllByType(GitPane)).toHaveLength(0)
  press(1)
  expect(dismiss).toHaveBeenCalledTimes(1)
  expect(renderer.root.findByType(FilesPane).props).toMatchObject({ rootPath: '/repo/worktrees/fix', active: true })
  const files = renderer.root.findByProps({ testID: 'files-content' }).instance
  expect(renderer.root.findByProps({ testID: 'session-pane-session' }).props.pointerEvents).toBe('none')
  expect(renderer.root.findByProps({ testID: 'session-pane-session' }).props.importantForAccessibility).toBe('no-hide-descendants')
  press(2)
  expect(renderer.root.findByType(GitPane).props).toMatchObject({ cwd: '/repo/worktrees/fix', active: true })
  expect(renderer.root.findByType(FilesPane).props.active).toBe(false)
  press(0)
  expect(renderer.root.findByType(TextInput).instance).toBe(chat)
  expect(renderer.root.findByType(TextInput).props.defaultValue).toBe('draft not yet sent')
  expect(renderer.root.findByProps({ testID: 'files-content' }).instance).toBe(files)
  expect(renderer.root.findByProps({ testID: 'session-pane-session' }).props.pointerEvents).toBe('auto')
})

test('missing cwd disables file and git rather than reading a default machine directory', () => {
  act(() => { renderer = Renderer.create(element()) })
  const tabs = renderer.root.findAllByType(TouchableOpacity)
  expect(tabs[0].props.disabled).toBe(false)
  expect(tabs[1].props.disabled).toBe(true)
  expect(tabs[2].props.disabled).toBe(true)
})
