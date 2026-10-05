import { useClaudeStore } from '../src/stores/claude-store'
import { useWorkspaceStore } from '../src/stores/workspace-store'
import { useConnectionStore } from '../src/stores/connection-store'
import type { SessionMeta, TerminalInstance } from '../src/types'

const sid = 'phone-panel'
const meta = (extra: Partial<SessionMeta> = {}): SessionMeta => ({
  totalCost: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, numTurns: 0, contextWindow: 0,
  ...extra,
})
const workspaceSave = jest.fn()
const message = (id: string) => ({ id, sessionId: sid, role: 'user' as const, content: id, timestamp: 1 })

beforeEach(() => {
  useClaudeStore.setState({ sessions: {}, activeSessionId: null })
  useWorkspaceStore.setState({ terminals: [{
    id: sid, workspaceId: 'ws', type: 'terminal', title: 'Codex', cwd: '/repo', scrollbackBuffer: [],
    sdkSessionId: 'stale-thread', agentPreset: 'codex-agent',
    agentParams: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', effortLevel: 'high' },
  } satisfies TerminalInstance] })
  useConnectionStore.setState({ channels: { workspace: { save: workspaceSave } } as never })
  workspaceSave.mockClear()
})

test('phone status updates shared terminal identity and scopes without sending a workspace save', () => {
  const store = useClaudeStore.getState()
  store.handleStatus(sid, meta({ sdkSessionId: 'phone-thread', codexSandboxMode: 'read-only', codexApprovalPolicy: 'untrusted' }))
  store.handleStatus(sid, meta({ isStreaming: true }))
  expect(useWorkspaceStore.getState().terminals[0]).toMatchObject({
    id: sid, sdkSessionId: 'phone-thread',
    agentParams: { sandboxMode: 'read-only', approvalPolicy: 'untrusted', effortLevel: 'high' },
  })
  expect(useClaudeStore.getState().sessions[sid].meta?.sdkSessionId).toBe('phone-thread')
  expect(workspaceSave).not.toHaveBeenCalled()
})

test('reconnect snapshot adopts host identity and permission settings before subsequent resume', () => {
  useClaudeStore.getState().handleSessionState(sid, {
    messages: [message('phone-message')], isStreaming: true,
    meta: meta({ sdkSessionId: 'phone-thread', codexSandboxMode: 'danger-full-access', codexApprovalPolicy: 'never' }),
  })
  expect(useWorkspaceStore.getState().terminals[0]).toMatchObject({
    sdkSessionId: 'phone-thread', agentParams: { sandboxMode: 'danger-full-access', approvalPolicy: 'never' },
  })
  expect(useClaudeStore.getState().sessions[sid].messages[0].id).toBe('phone-message')
  expect(workspaceSave).not.toHaveBeenCalled()
})

test('a changed host SDK id replaces old conversation history even with a shorter snapshot', () => {
  const store = useClaudeStore.getState()
  store.handleSessionState(sid, {
    messages: [message('old-1'), message('old-2'), message('old-3')],
    meta: meta({ sdkSessionId: 'stale-thread' }),
  })
  const verdict = store.handleSessionState(sid, {
    messages: [message('phone-message')], meta: meta({ sdkSessionId: 'phone-thread' }),
  })
  expect(verdict).toBe('adopted')
  expect(useClaudeStore.getState().sessions[sid].messages.map(item => item.id)).toEqual(['phone-message'])
})

test('status announcing a new thread clears stale transcript and stream text', () => {
  const store = useClaudeStore.getState()
  store.handleSessionState(sid, {
    messages: [message('old')], streamingText: 'old partial answer',
    meta: meta({ sdkSessionId: 'stale-thread' }),
  })
  store.handleStatus(sid, meta({ sdkSessionId: 'phone-thread', isStreaming: true }))
  expect(useClaudeStore.getState().sessions[sid].messages).toEqual([])
  expect(useClaudeStore.getState().sessions[sid].streamingText).toBe('')
})

test('explicit session reset clears resume identity and keeps permission settings', () => {
  const store = useClaudeStore.getState()
  store.handleStatus(sid, meta({ sdkSessionId: 'phone-thread', codexSandboxMode: 'read-only', codexApprovalPolicy: 'untrusted' }))
  store.handleSessionReset(sid)
  expect(useWorkspaceStore.getState().terminals[0].sdkSessionId).toBeUndefined()
  expect(useWorkspaceStore.getState().terminals[0].agentParams).toMatchObject({ sandboxMode: 'read-only', approvalPolicy: 'untrusted' })
  expect(workspaceSave).not.toHaveBeenCalled()
})
