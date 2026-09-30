import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { TextInput } from 'react-native'
import { TerminalScreen } from '../src/screens/TerminalScreen'
import { useConnectionStore } from '../src/stores/connection-store'
import { useWorkspaceStore } from '../src/stores/workspace-store'

jest.mock('@react-navigation/native', () => ({ useFocusEffect: () => {} }))
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0, left: 0, right: 0 }),
}))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
jest.mock('react-native-webview', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    WebView: React.forwardRef((props: unknown, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({ injectJavaScript: jest.fn() }))
      return React.createElement(View, props)
    }),
  }
})
jest.mock('../src/components/session/SessionContextBar', () => ({
  SessionContextBar: () => null,
}))
jest.mock('../src/components/session/SessionWorkspaceTabs', () => ({
  SessionWorkspaceTabs: ({ children }: { children: React.ReactNode }) =>
    children,
}))
let renderer: Renderer.ReactTestRenderer
let write: jest.Mock

beforeEach(() => {
  write = jest.fn().mockResolvedValue(undefined)
  const channels = {
    pty: { write, onOutput: () => () => {}, onViewportState: () => () => {} },
  }
  useConnectionStore.setState({ channels: channels as never })
  useWorkspaceStore.setState({
    loadStatus: 'ok',
    workspaces: [{ id: 'w', name: 'w', folderPath: '/repo', createdAt: 0 }],
    terminals: [
      {
        id: 's',
        workspaceId: 'w',
        type: 'terminal',
        title: 'shell',
        cwd: '/repo',
        scrollbackBuffer: [],
      },
    ],
  })
  act(() => {
    renderer = Renderer.create(
      <TerminalScreen
        route={{ params: { terminalId: 's' } } as never}
        navigation={
          {
            getParent: () => ({ setOptions: jest.fn() }),
            setOptions: jest.fn(),
            goBack: jest.fn(),
          } as never
        }
      />,
    )
  })
})
afterEach(() => act(() => renderer.unmount()))
const command = () => renderer.root.findByType(TextInput)
const key = (label: string) =>
  renderer.root.findByProps({ testID: `terminal-key-${label}` })

test('native IME/paste remains intact until Enter sends the entire command', async () => {
  act(() => command().props.onChangeText('echo 中文測試'))
  expect(write).not.toHaveBeenCalled()
  await act(async () => command().props.onSubmitEditing())
  expect(write).toHaveBeenCalledWith('s', 'echo 中文測試\r')
  expect(command().props.value).toBe('')
})

test('Ctrl+C and Escape are immediately available and send real control bytes', async () => {
  act(() => command().props.onChangeText('unsent'))
  await act(async () => {
    key('Ctrl+C').props.onPress()
    key('Esc').props.onPress()
  })
  expect(write.mock.calls).toEqual([
    ['s', '\x03'],
    ['s', '\x1b'],
  ])
  expect(command().props.value).toBe('unsent')
})

test('failed command writes preserve the text for retry', async () => {
  write.mockRejectedValueOnce(new Error('offline'))
  act(() => command().props.onChangeText('keep this'))
  await act(async () => command().props.onSubmitEditing())
  expect(command().props.value).toBe('keep this')
})

test('double Enter does not submit twice while a write is pending', async () => {
  let finish!: () => void
  write.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve
      }),
  )
  act(() => command().props.onChangeText('once'))
  act(() => {
    key('Enter').props.onPress()
    key('Enter').props.onPress()
  })
  expect(write).toHaveBeenCalledTimes(1)
  await act(async () => finish())
  expect(command().props.value).toBe('')
})

test('text typed during an in-flight command is not erased by its acknowledgement', async () => {
  let finish!: () => void
  write.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve
      }),
  )
  act(() => command().props.onChangeText('first'))
  act(() => key('Enter').props.onPress())
  act(() => command().props.onChangeText('next'))
  await act(async () => finish())
  expect(command().props.value).toBe('next')
})
