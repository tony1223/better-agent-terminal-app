import {
  useAgentPreferencesStore,
  resolveEffort,
} from '../src/stores/agent-preferences-store'
import { useSessionDraftsStore } from '../src/stores/session-drafts-store'

beforeEach(() => {
  useAgentPreferencesStore.setState({ efforts: {} })
  useSessionDraftsStore.setState({ drafts: {} })
})

test('remembers effort for reopening a session and creating another of the same agent family', () => {
  const preferences = useAgentPreferencesStore.getState()
  preferences.remember('host/profile', 's1', 'codex-agent', 'xhigh')
  expect(preferences.sessionEffort('host/profile', 's1')).toBe('xhigh')
  expect(
    preferences.defaultEffort('host/profile', 'codex-agent-worktree'),
  ).toBe('xhigh')
  expect(
    preferences.defaultEffort('host/profile', 'claude-code'),
  ).toBeUndefined()
  expect(
    preferences.defaultEffort('host/other-profile', 'codex-agent'),
  ).toBeUndefined()
  expect(preferences.sessionEffort('other-host/profile', 's1')).toBeUndefined()
})

test('invalid efforts cannot replace a saved preference; authoritative effort wins', () => {
  const preferences = useAgentPreferencesStore.getState()
  preferences.remember('p', 's', 'claude-code', 'low')
  preferences.remember('p', 's', 'claude-code', 'invalid')
  expect(preferences.sessionEffort('p', 's')).toBe('low')
  expect(resolveEffort('medium', 'low', 'high')).toBe('medium')
  expect(resolveEffort(undefined, 'invalid', 'low')).toBe('low')
})

test('switching profile/session preserves independent unsent drafts and images', () => {
  const a = JSON.stringify(['a', 's'])
  const b = JSON.stringify(['b', 's'])
  const store = useSessionDraftsStore.getState()
  store.update(a, { text: 'keep me', images: [{ uri: 'u', dataUrl: 'data' }] })
  store.update(b, { text: 'other profile' })
  store.update(a, { text: '' })
  expect(useSessionDraftsStore.getState().drafts[a].images).toHaveLength(1)
  store.update(a, { images: [] })
  expect(useSessionDraftsStore.getState().drafts[a]).toBeUndefined()
  expect(useSessionDraftsStore.getState().drafts[b].text).toBe('other profile')
})
