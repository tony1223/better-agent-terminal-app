import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { AppState, Linking, Text, type AppStateStatus } from 'react-native'
import { HostAccountManager, type AccountProvider } from '../src/components/accounts/HostAccountManager'
import { HostAccountLogin } from '../src/components/accounts/HostAccountLogin'
import { useConnectionStore } from '../src/stores/connection-store'
import type { Channels } from '../src/api/channels'
import { createClaudeChannel } from '../src/api/channels/claude'
import { SettingsScreen } from '../src/screens/SettingsScreen'

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

jest.mock('react-i18next', () => {
  const t = (key: string) => key
  return { ...jest.requireActual('react-i18next'), useTranslation: () => ({ t }) }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
let renderer: Renderer.ReactTestRenderer | undefined
let channels: Channels
let api: Record<string, jest.Mock>
let appStateChanged: (state: AppStateStatus) => void
const onClose = jest.fn()
const onSuccess = jest.fn()
const button = (id: string) => renderer!.root.findByProps({ testID: id })
const texts = () => renderer!.root.findAllByType(Text).map(node => node.props.children).join(' ')
async function mount(provider: AccountProvider, login = false) {
  await act(async () => { renderer = Renderer.create(login
    ? <HostAccountLogin provider={provider} channels={channels} onSuccess={onSuccess} />
    : <HostAccountManager provider={provider} channels={channels} onClose={onClose} />) })
}
beforeEach(() => {
  jest.useFakeTimers()
  onClose.mockClear()
  onSuccess.mockClear()
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' })
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    appStateChanged = callback
    return { remove: jest.fn() }
  })
  jest.spyOn(Linking, 'openURL').mockClear().mockResolvedValue(undefined)
  api = Object.fromEntries(['codexAccountList', 'accountList', 'codexAccountSwitch', 'accountSwitch',
    'codexAuthLoginStart', 'codexAuthLoginPoll', 'codexAuthLoginCancel',
    'authLoginStart', 'authLoginSubmitCode', 'authLoginCancel'].map(name => [name, jest.fn().mockResolvedValue(null)]))
  api.codexAccountList.mockResolvedValue({ activeCodexHome: '/shared', accounts: [
    { id: 'a', email: 'a@example.test', active: true, unified: true, codexHome: '/shared' },
    { id: 'b', email: 'b@example.test', active: false, unified: true, codexHome: '/shared' },
    { id: 'expired', needsLogin: true },
  ] })
  api.accountList.mockResolvedValue({ activeAccountId: 'a', accounts: [{ id: 'a', email: 'a@example.test' }, { id: 'b', email: 'b@example.test' }] })
  api.codexAccountSwitch.mockResolvedValue({ success: true })
  api.accountSwitch.mockResolvedValue(true)
  const start = { ok: true, loginId: 'owned-login', url: 'https://auth.example.test/approve', code: 'ABCD-EFGH' }
  api.codexAuthLoginStart.mockResolvedValue(start)
  api.authLoginStart.mockResolvedValue(start)
  api.codexAuthLoginPoll.mockResolvedValue({ status: 'pending' })
  channels = { claude: api, app: { getVersion: jest.fn().mockResolvedValue({ version: 'test' }) } } as unknown as Channels
  useConnectionStore.setState({ channels, status: 'connected', profileStatus: 'ready',
    client: { supportsProfileContext: true } as never, selectedProfileName: 'Test host', selectedProfileId: 'p', profileViewKey: 'p', host: 'host', port: 9876 })
})
afterEach(() => {
  if (renderer) act(() => renderer!.unmount())
  renderer = undefined
  jest.useRealTimers()
  jest.restoreAllMocks()
})

test.each<AccountProvider>(['codex', 'claude'])('switches %s on the selected host, blocks duplicate taps and refreshes the active account', async provider => {
  await mount(provider)
  expect(button('account-a').props.disabled).toBe(true)
  expect(button('account-b').props.disabled).toBe(false)
  if (provider === 'codex') expect(button('account-expired').props.disabled).toBe(true)
  const change = provider === 'codex' ? api.codexAccountSwitch : api.accountSwitch
  const list = provider === 'codex' ? api.codexAccountList : api.accountList
  const pending = deferred<any>()
  change.mockReturnValue(pending.promise)
  let switching!: Promise<void>
  act(() => { switching = button('account-b').props.onPress(); button('account-b').props.onPress() })
  expect(change).toHaveBeenCalledTimes(1)
  expect(change).toHaveBeenCalledWith('b')
  list.mockResolvedValue({ activeAccountId: 'b', accounts: [{ id: 'b', active: true }] })
  await act(async () => { pending.resolve(provider === 'codex' ? { success: true } : true); await switching })
  expect(button('account-b').props.disabled).toBe(true)
  expect(texts()).toContain('accounts.switched')
})

test.each<AccountProvider>(['codex', 'claude'])('shows a rejected %s account switch instead of silently closing', async provider => {
  await mount(provider)
  const change = provider === 'codex' ? api.codexAccountSwitch : api.accountSwitch
  change.mockResolvedValue(provider === 'codex' ? { success: false } : false)
  await act(async () => button('account-b').props.onPress())
  expect(texts()).toContain('accounts.switchFailed')
  expect(onClose).not.toHaveBeenCalled()
})

test('list failure is distinguishable from an empty list and can be retried', async () => {
  api.accountList.mockRejectedValueOnce(new Error('offline'))
  await mount('claude')
  expect(texts()).toContain('offline')
  expect(texts()).not.toContain('accounts.empty')
  await act(async () => button('accounts-refresh').props.onPress())
  expect(button('account-a')).toBeDefined()
})

test('profile switch closes the manager and ignores a pending switch acknowledgement', async () => {
  await mount('codex')
  const pending = deferred<any>()
  api.codexAccountSwitch.mockReturnValue(pending.promise)
  let switching!: Promise<void>
  act(() => { switching = button('account-b').props.onPress() })
  act(() => useConnectionStore.setState({ channels: null }))
  expect(onClose).toHaveBeenCalled()
  await act(async () => { pending.resolve({ success: true }); await switching })
  expect(api.codexAccountList).toHaveBeenCalledTimes(1)
  expect(texts()).not.toContain('accounts.switched')
})

test('Codex pauses polling in the browser and checks immediately on returning; success does not cancel the login', async () => {
  await mount('codex', true)
  expect(button('login-device-code').props.children).toBe('ABCD-EFGH')
  await act(async () => button('login-open-browser').props.onPress())
  expect(Linking.openURL).toHaveBeenCalledWith('https://auth.example.test/approve')
  act(() => appStateChanged('background'))
  await act(async () => jest.advanceTimersByTime(20_000))
  expect(api.codexAuthLoginPoll).toHaveBeenCalledTimes(1)
  api.codexAuthLoginPoll.mockResolvedValue({ status: 'success' })
  await act(async () => appStateChanged('active'))
  expect(api.codexAuthLoginPoll).toHaveBeenLastCalledWith('owned-login')
  expect(onSuccess).toHaveBeenCalledTimes(1)
  act(() => renderer!.unmount())
  renderer = undefined
  expect(api.codexAuthLoginCancel).not.toHaveBeenCalled()
})

test('Codex does not overlap polls and displays host expiry', async () => {
  const pending = deferred<any>()
  api.codexAuthLoginPoll.mockReturnValue(pending.promise)
  await mount('codex', true)
  await act(async () => { appStateChanged('active'); jest.advanceTimersByTime(10_000) })
  expect(api.codexAuthLoginPoll).toHaveBeenCalledTimes(1)
  await act(async () => pending.resolve({ status: 'error', error: 'login expired' }))
  expect(texts()).toContain('login expired')
  await act(async () => jest.advanceTimersByTime(10_000))
  expect(api.codexAuthLoginPoll).toHaveBeenCalledTimes(1)
})

test('Claude submits the pasted code with the owned login ID, permits corrected code, and completes on the host', async () => {
  await mount('claude', true)
  api.authLoginSubmitCode.mockResolvedValueOnce({ success: false, terminal: false, error: 'wrong code' }).mockResolvedValueOnce({ success: true })
  act(() => button('login-code-input').props.onChangeText(' wrong '))
  await act(async () => button('login-submit').props.onPress())
  expect(texts()).toContain('wrong code')
  act(() => button('login-code-input').props.onChangeText(' correct '))
  await act(async () => button('login-submit').props.onPress())
  expect(api.authLoginSubmitCode).toHaveBeenLastCalledWith('correct', 'owned-login')
  expect(onSuccess).toHaveBeenCalledTimes(1)
  expect(api.codexAuthLoginPoll).not.toHaveBeenCalled()
})

test.each<AccountProvider>(['codex', 'claude'])('closing during %s start cancels only the late owned login', async provider => {
  const pending = deferred<any>()
  const start = provider === 'codex' ? api.codexAuthLoginStart : api.authLoginStart
  const cancel = provider === 'codex' ? api.codexAuthLoginCancel : api.authLoginCancel
  start.mockReturnValue(pending.promise)
  await mount(provider, true)
  act(() => renderer!.unmount())
  renderer = undefined
  expect(cancel).not.toHaveBeenCalled()
  await act(async () => pending.resolve({ ok: true, loginId: 'late-owned', url: 'https://auth.example.test/', code: '123' }))
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(cancel).toHaveBeenCalledWith('late-owned')
  expect(onSuccess).not.toHaveBeenCalled()
})

test('a refused login does not cancel another client’s authentication', async () => {
  api.authLoginStart.mockResolvedValue({ ok: false, error: 'auth_in_progress' })
  await mount('claude', true)
  expect(texts()).toContain('accounts.inProgress')
  act(() => renderer!.unmount())
  renderer = undefined
  expect(api.authLoginCancel).not.toHaveBeenCalled()
})

test('old hosts get an actionable unsupported-login message', async () => {
  api.codexAuthLoginStart.mockRejectedValue(new Error('Method not found'))
  await mount('codex', true)
  expect(texts()).toContain('accounts.unsupported')
})

test('does not open a non-browser authentication URL', async () => {
  api.authLoginStart.mockResolvedValue({ ok: true, loginId: 'owned-login', url: 'file:///secret' })
  await mount('claude', true)
  expect(texts()).toContain('accounts.invalidUrl')
  expect(Linking.openURL).not.toHaveBeenCalled()
})

test.each<AccountProvider>(['codex', 'claude'])('successful %s login refreshes the manager without cancelling', async provider => {
  await mount(provider)
  if (provider === 'codex') api.codexAuthLoginPoll.mockResolvedValue({ status: 'success' })
  else api.authLoginSubmitCode.mockResolvedValue({ success: true })
  await act(async () => button('account-login').props.onPress())
  if (provider === 'claude') {
    act(() => button('login-code-input').props.onChangeText('code'))
    await act(async () => button('login-submit').props.onPress())
  }
  expect(texts()).toContain('accounts.loginSucceeded')
  expect(provider === 'codex' ? api.codexAccountList : api.accountList).toHaveBeenCalledTimes(2)
  expect(provider === 'codex' ? api.codexAuthLoginCancel : api.authLoginCancel).not.toHaveBeenCalled()
})

test('authentication channel parameters preserve the host login ID in v2 and legacy forms', async () => {
  const transport = { invokeParams: jest.fn().mockResolvedValue({}), invoke: jest.fn(), on: jest.fn() }
  const channel = createClaudeChannel(transport)
  await channel.authLoginSubmitCode('one-time-code', 'owned')
  expect(transport.invokeParams).toHaveBeenLastCalledWith('agent:auth-login-submit-code',
    { code: 'one-time-code', loginId: 'owned' }, ['one-time-code', 'owned'], { timeoutMs: 300_000 })
  await channel.codexAuthLoginPoll('owned')
  expect(transport.invokeParams).toHaveBeenLastCalledWith('codex:auth-login-device-poll',
    { loginId: 'owned' }, ['owned'], { timeoutMs: 300_000 })
})

test.each<AccountProvider>(['codex', 'claude'])('settings opens %s accounts without requiring a chat session', async provider => {
  await act(async () => { renderer = Renderer.create(<SettingsScreen />) })
  await act(async () => button(`settings-accounts-${provider}`).props.onPress())
  expect(provider === 'codex' ? api.codexAccountList : api.accountList).toHaveBeenCalledTimes(1)
  expect(button('account-login')).toBeDefined()
})

test.each<AccountProvider>(['codex', 'claude'])('%s login survives browser-time reconnect to the same profile without restarting authentication', async provider => {
  await mount(provider)
  await act(async () => button('account-login').props.onPress())
  act(() => appStateChanged('background'))
  act(() => useConnectionStore.setState({ status: 'reconnecting', profileStatus: 'loading' }))
  const nextApi = { ...api, codexAuthLoginPoll: jest.fn().mockResolvedValue({ status: 'success' }), authLoginSubmitCode: jest.fn().mockResolvedValue({ success: true }) }
  const nextChannels = { claude: nextApi } as unknown as Channels
  await act(async () => useConnectionStore.setState({ channels: nextChannels, status: 'connected', profileStatus: 'ready' }))
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => appStateChanged('active'))
  if (provider === 'claude') {
    act(() => button('login-code-input').props.onChangeText('approved'))
    await act(async () => button('login-submit').props.onPress())
    expect(nextApi.authLoginSubmitCode).toHaveBeenCalledWith('approved', 'owned-login')
    expect(api.authLoginSubmitCode).not.toHaveBeenCalled()
  } else expect(nextApi.codexAuthLoginPoll).toHaveBeenCalledWith('owned-login')
  expect(provider === 'codex' ? api.codexAuthLoginStart : api.authLoginStart).toHaveBeenCalledTimes(1)
  expect(texts()).toContain('accounts.loginSucceeded')
})

test('Claude authorization code never crosses to a different profile, even before the modal unmounts', async () => {
  await mount('claude', true)
  act(() => button('login-code-input').props.onChangeText('private-code'))
  const otherSubmit = jest.fn()
  act(() => useConnectionStore.setState({ selectedProfileId: 'other', profileViewKey: 'other',
    channels: { claude: { authLoginSubmitCode: otherSubmit } } as unknown as Channels }))
  await act(async () => button('login-submit').props.onPress())
  expect(api.authLoginSubmitCode).not.toHaveBeenCalled()
  expect(otherSubmit).not.toHaveBeenCalled()
  act(() => renderer!.unmount())
  renderer = undefined
  expect(api.authLoginCancel).toHaveBeenCalledWith('owned-login')
})

test('legacy Codex homes identify the active account without marking unified accounts active', async () => {
  api.codexAccountList.mockResolvedValue({ activeCodexHome: '/home', accounts: [
    { id: '/home', codexHome: '/home' },
    { id: 'unified', codexHome: '/home', unified: true },
  ] })
  await mount('codex')
  expect(button('account-/home').props.disabled).toBe(true)
  expect(button('account-unified').props.disabled).toBe(false)
})
