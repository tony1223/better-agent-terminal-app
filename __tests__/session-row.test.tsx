import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { AppState, Text, type AppStateStatus } from 'react-native'
import { useSessionPreviews } from '../src/hooks/use-session-previews'
import { SessionRow } from '../src/components/session/SessionRow'
import {
  useSessionPreviewStore,
  PREVIEW_REFRESH_MS,
} from '../src/stores/session-preview-store'
import { useConnectionStore } from '../src/stores/connection-store'
import { useClaudeStore } from '../src/stores/claude-store'
import { useRecentsStore } from '../src/stores/recents-store'
import { formatSessionTimestamp } from '../src/utils/chat-timestamp'
import type { TerminalInstance } from '../src/types'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) =>
    require('react').useEffect(effect, [effect]),
}))
jest.mock('../src/components/session/WorktreeControls', () => ({
  WorktreeControls: () => null,
}))
let renderer: Renderer.ReactTestRenderer | undefined
const now = new Date(2026, 9, 3, 12, 10, 0)
const updated = new Date(2026, 9, 3, 12, 9, 49).getTime()
const opened = new Date(2026, 9, 3, 12, 8, 39).getTime()
const channels = {} as NonNullable<
  ReturnType<typeof useConnectionStore.getState>['channels']
>

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(now)
  useClaudeStore.setState({ sessions: {} })
  useSessionPreviewStore.setState({
    previews: {},
    timestamps: {},
    fetchedAt: {},
  })
  useRecentsStore.setState({ sessions: {} })
  useConnectionStore.setState({ status: 'connected', channels, client: null })
})
afterEach(() => {
  if (renderer) act(() => renderer!.unmount())
  renderer = undefined
  jest.restoreAllMocks()
  jest.useRealTimers()
})

test('compact list times omit seconds while preserving full dates for accessibility', () => {
  expect(formatSessionTimestamp(updated, now)).toEqual({
    short: '12:09',
    full: '2026-10-03 12:09:49',
  })
  expect(
    formatSessionTimestamp(new Date(2026, 8, 3, 1, 2, 3).getTime(), now)?.short,
  ).toBe('09/03 01:02')
  expect(
    formatSessionTimestamp(new Date(2025, 8, 3, 1, 2, 3).getTime(), now)?.short,
  ).toBe('2025/09/03 01:02')
  expect(formatSessionTimestamp(NaN, now)).toBeNull()
})

test('row shows compact labelled times and follows new prompts without opening the session', () => {
  const terminal = {
    id: 's',
    title: 'Codex Agent',
    agentPreset: 'codex-agent',
    cwd: '/repo',
  } as TerminalInstance
  useSessionPreviewStore.setState({
    previews: { s: 'old reply' },
    timestamps: { s: opened },
  })
  useClaudeStore.getState().handleLastDataAt('s', updated)
  useRecentsStore.setState({
    sessions: { s: { id: 's', count: 1, lastOpenedAt: opened } },
  })
  act(() => {
    renderer = Renderer.create(
      <SessionRow
        terminal={terminal}
        closing={false}
        onPress={jest.fn()}
        onRequestClose={jest.fn()}
        onCloseSession={jest.fn()}
      />,
    )
  })
  const text = () =>
    renderer!.root
      .findAllByType(Text)
      .map(node => React.Children.toArray(node.props.children).join(''))
  expect(text()).toContain('session.recency.updatedShort 12:09')
  expect(text()).toContain('session.recency.openedShort 12:08')
  expect(text()).toContain('old reply')
  act(() =>
    useClaudeStore
      .getState()
      .handleHistory('s', [
        {
          id: 'u',
          sessionId: 's',
          role: 'user',
          content: 'fix the reconnect delay',
          timestamp: updated,
        },
      ]),
  )
  expect(text()).toContain('fix the reconnect delay')
  expect(text()).not.toContain('old reply')
})

function List() {
  useSessionPreviews(['s'])
  return null
}

test('preview polling pauses in the background and cancels on leaving the list', async () => {
  let onChange!: (state: AppStateStatus) => void
  const remove = jest.fn()
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    onChange = listener
    return { remove }
  })
  const load = jest
    .spyOn(useSessionPreviewStore.getState(), 'load')
    .mockResolvedValue()
  await act(async () => {
    renderer = Renderer.create(<List />)
  })
  expect(load).toHaveBeenCalledTimes(1)
  await act(async () => {
    jest.advanceTimersByTime(PREVIEW_REFRESH_MS)
  })
  expect(load).toHaveBeenCalledTimes(2)
  act(() => onChange('background'))
  expect(load.mock.calls[1][1]!()).toBe(false)
  await act(async () => {
    jest.advanceTimersByTime(PREVIEW_REFRESH_MS * 3)
  })
  expect(load).toHaveBeenCalledTimes(2)
  await act(async () => {
    onChange('active')
  })
  expect(load).toHaveBeenCalledTimes(3)
  act(() => renderer!.unmount())
  renderer = undefined
  expect(load.mock.calls[2][1]!()).toBe(false)
  await act(async () => {
    jest.advanceTimersByTime(PREVIEW_REFRESH_MS * 2)
  })
  expect(load).toHaveBeenCalledTimes(3)
  expect(remove).toHaveBeenCalled()
})
