/**
 * ClaudeScreen - Claude agent chat interface
 */

import React, { useState, useRef, useCallback, useEffect, useMemo, useLayoutEffect } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  Keyboard,
  Platform,
  FlatList,
  ScrollView,
  Modal,
  Image,
  Alert,
} from 'react-native'
import type { KeyboardEvent } from 'react-native'
import { launchImageLibrary } from 'react-native-image-picker'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useClaudeStore, EMPTY_SESSION } from '@/stores/claude-store'
import { useConnectionStore } from '@/stores/connection-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { appColors, spacing, fontSize } from '@/theme/colors'
import { MessageBubble } from '@/components/claude/MessageBubble'
import { ToolCallCard } from '@/components/claude/ToolCallCard'
import { StreamingText } from '@/components/claude/StreamingText'
import { ChatFilterButton } from '@/components/claude/ChatFilterButton'
import { ChatFilterStrip } from '@/components/claude/ChatFilterStrip'
import { HiddenBlocksPlaceholder } from '@/components/claude/HiddenBlocksPlaceholder'
import { RuntimeStatusBar } from '@/components/claude/RuntimeStatusBar'
import { SessionContextBar } from '@/components/session/SessionContextBar'
import { useChatFilterStore } from '@/stores/chat-filter-store'
import { dlog } from '@/utils/debug-log'
import { classifyChatItem, type ChatItemKind } from '@/utils/classify-chat-item'
import { setModelArgsForClaudeSelection } from '@/utils/claude-model-presets'
import type { ClaudeMessage, ClaudeToolCall } from '@/types'
import type { CodexAccountEntry } from '@/api/channels/claude'
import { isToolCall } from '@/types'
import { useFocusEffect } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'

type Props = NativeStackScreenProps<any, 'Claude'>

function fmtRemaining(resetDate: Date): string {
  const diff = resetDate.getTime() - Date.now()
  if (diff <= 0) return 'now'
  const d = Math.floor(diff / 86_400_000)
  const h = Math.floor((diff % 86_400_000) / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${m}m`
  return `${m}m`
}

const PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'planBypass', 'plan'] as const
const PERMISSION_LABELS: Record<string, string> = {
  default: '\u270F Default',
  acceptEdits: '\u270F Auto-edit',
  bypassPermissions: '\u26A0 Bypass',
  planBypass: '\uD83D\uDCCB Plan+',
  plan: '\uD83D\uDCCB Plan',
}

const CLAUDE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const CODEX_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const
const CODEX_SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const
const CODEX_APPROVAL_POLICIES = ['untrusted', 'on-request', 'never'] as const
const MAX_IMAGES = 5
// ~2 MiB decoded. Larger images go through fs:upload-tmp-* to the host's tmp
// dir instead of riding inline in the agent:send-message frame.
const MAX_INLINE_IMAGE_BASE64_CHARS = 2 * 1398104
const INITIAL_LOAD_UI_TIMEOUT_MS = 6_000

function selectedTint(color: string): string {
  if (color === appColors.agentCodex) return 'rgba(16, 163, 127, 0.18)'
  if (color === appColors.info) return 'rgba(59, 130, 246, 0.18)'
  return 'rgba(217, 119, 6, 0.18)'
}

interface SessionSummary {
  sdkSessionId: string
  timestamp: number
  preview: string
  messageCount: number
  customTitle?: string
  firstPrompt?: string
  gitBranch?: string
  createdAt?: number
  summary?: string
}

interface ModelOption {
  value: string
  displayName: string
  description?: string
}

type ListEntry =
  | { kind: 'item'; data: ClaudeMessage | ClaudeToolCall }
  | { kind: 'placeholder'; itemKind: ChatItemKind; count: number; id: string }

function normalizeModelOptions(raw: unknown): ModelOption[] {
  if (!Array.isArray(raw)) return []

  return raw.flatMap((item): ModelOption[] => {
    if (typeof item === 'string') {
      return [{ value: item, displayName: item }]
    }
    if (!item || typeof item !== 'object') return []

    const record = item as Record<string, unknown>
    const value = typeof record.value === 'string'
      ? record.value
      : typeof record.id === 'string' ? record.id
        : typeof record.name === 'string' ? record.name : null
    if (!value) return []

    return [{
      value,
      displayName: typeof record.displayName === 'string' ? record.displayName : value,
      description: typeof record.description === 'string' ? record.description : undefined,
    }]
  })
}

function normalizeStringOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(item => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

function optionalText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function numericValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function normalizeSessionSummaries(raw: unknown): SessionSummary[] {
  if (!Array.isArray(raw)) return []

  return raw.flatMap((item): SessionSummary[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const sdkSessionId = optionalText(record.sdkSessionId ?? record.sessionId ?? record.id)
    if (!sdkSessionId) return []

    const timestamp = numericValue(record.timestamp ?? record.createdAt, Date.now())
    return [{
      sdkSessionId,
      timestamp,
      preview: optionalText(record.preview) ?? '',
      messageCount: numericValue(record.messageCount, 0),
      customTitle: optionalText(record.customTitle),
      firstPrompt: optionalText(record.firstPrompt),
      gitBranch: optionalText(record.gitBranch),
      createdAt: record.createdAt == null ? undefined : numericValue(record.createdAt, timestamp),
      summary: optionalText(record.summary),
    }]
  })
}

export function ClaudeScreen({ route, navigation }: Props) {
  const { t } = useTranslation()
  const sessionId = route.params?.sessionId as string
  const channels = useConnectionStore(s => s.channels)
  const connectionStatus = useConnectionStore(s => s.status)
  const checkConnection = useConnectionStore(s => s.checkConnection)
  const session = useClaudeStore(s => s.sessions[sessionId] || EMPTY_SESSION)
  const chatFilters = useChatFilterStore(s => s.getFilter(sessionId))
  const setChatFilterKind = useChatFilterStore(s => s.setKind)
  const promptSuggestions = useClaudeStore(s => s.promptSuggestions)
  const terminal = useWorkspaceStore(s => s.terminals.find(item => item.id === sessionId))
  const workspace = useWorkspaceStore(s => {
    const term = s.terminals.find(item => item.id === sessionId)
    return term ? s.workspaces.find(w => w.id === term.workspaceId) : undefined
  })
  const loadStatus = useWorkspaceStore(s => s.loadStatus)

  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(true)
  const [permissionMode, setPermissionMode] = useState('bypassPermissions')
  const [effortLevel, setEffortLevel] = useState('high')
  const [codexSandboxMode, setCodexSandboxMode] = useState('workspace-write')
  const [codexApprovalPolicy, setCodexApprovalPolicy] = useState('on-request')
  const [showFab, setShowFab] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showEffortPicker, setShowEffortPicker] = useState(false)
  const [showSandboxPicker, setShowSandboxPicker] = useState(false)
  const [showApprovalPicker, setShowApprovalPicker] = useState(false)
  const [showCodexAccountPicker, setShowCodexAccountPicker] = useState(false)
  const [codexAccounts, setCodexAccounts] = useState<CodexAccountEntry[]>([])
  const [codexAccountsLoading, setCodexAccountsLoading] = useState(false)
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([])
  const [supportedEffortOptions, setSupportedEffortOptions] = useState<string[]>([])
  const [supportedSandboxOptions, setSupportedSandboxOptions] = useState<string[]>([])
  const [supportedApprovalOptions, setSupportedApprovalOptions] = useState<string[]>([])
  const [attachedImages, setAttachedImages] = useState<{ uri: string; dataUrl: string }[]>([])
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null)
  const [historyLoadingInBackground, setHistoryLoadingInBackground] = useState(false)
  // Set when a session's history could not be loaded so the empty view can
  // explain *why* (connection dropped vs. the host no longer has the rollout)
  // instead of the misleading "no messages yet".
  const [loadError, setLoadError] = useState<null | 'connection' | 'missing'>(null)
  const [usage, setUsage] = useState<{ fiveHour: number | null; sevenDay: number | null; fiveHourReset: string | null; sevenDayReset: string | null } | null>(null)
  const [showResumeList, setShowResumeList] = useState(false)
  const [resumeSessions, setResumeSessions] = useState<SessionSummary[]>([])
  const [resumeLoading, setResumeLoading] = useState(false)
  const isAtBottomRef = useRef(true)
  const listRef = useRef<any>(null)
  const sendInFlightRef = useRef(false)
  const loadSeqRef = useRef(0)
  const loadedSessionKeyRef = useRef<string | null>(null)
  const inFlightSessionKeyRef = useRef<string | null>(null)
  const focusRefreshedRef = useRef(false)
  const agentPreset = terminal?.agentPreset
  const isCodexAgent = agentPreset === 'codex-agent' || agentPreset === 'codex-agent-worktree'
  const isClaudeCodeAgent = agentPreset === 'claude-code' || agentPreset === 'claude-code-v2' || agentPreset === 'claude-code-worktree'
  const isOpenAIAgent = agentPreset === 'openai-agent'
  const agentColor = isCodexAgent
    ? appColors.agentCodex
    : isOpenAIAgent ? appColors.info : appColors.agentClaudeCode
  const agentSelectedBg = selectedTint(agentColor)
  const fallbackEffortOptions = useMemo(
    () => isCodexAgent ? [...CODEX_EFFORT_LEVELS] : [...CLAUDE_EFFORT_LEVELS],
    [isCodexAgent],
  )
  const effortOptions = useMemo(
    () => supportedEffortOptions.length > 0 ? supportedEffortOptions : fallbackEffortOptions,
    [fallbackEffortOptions, supportedEffortOptions],
  )
  const sandboxOptions = useMemo(
    () => supportedSandboxOptions.length > 0 ? supportedSandboxOptions : [...CODEX_SANDBOX_MODES],
    [supportedSandboxOptions],
  )
  const approvalOptions = useMemo(
    () => supportedApprovalOptions.length > 0 ? supportedApprovalOptions : [...CODEX_APPROVAL_POLICIES],
    [supportedApprovalOptions],
  )
  const terminalCwd = terminal?.cwd
  const terminalSdkSessionId = terminal?.sdkSessionId
  const terminalModel = terminal?.model
  const terminalWorktreePath = terminal?.worktreePath
  const terminalBranchName = terminal?.branchName
  const terminalSandboxMode = terminal?.agentParams?.sandboxMode
  const terminalApprovalPolicy = terminal?.agentParams?.approvalPolicy
  const insets = useSafeAreaInsets()
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  // Lift the input above the keyboard on both platforms. Android can't rely on
  // windowSoftInputMode=adjustResize here: RN 0.84 enables edge-to-edge by
  // default, which stops the window from resizing for the keyboard, so we apply
  // the measured keyboard height as a bottom margin just like iOS does.
  const keyboardBottomInset = Math.max(0, keyboardHeight)
  const inputAreaPaddingBottom = keyboardHeight > 0
    ? spacing.sm
    : Math.max(insets.bottom, spacing.lg)

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          style={styles.headerBackButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.headerBackText}>{'\u2190'}</Text>
        </TouchableOpacity>
      ),
      headerRight: () => <ChatFilterButton sessionId={sessionId} />,
      headerTitle: () => (
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {workspace?.alias || workspace?.name || t('claude.defaultWorkspace')}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {terminal?.alias || terminal?.title || t('claude.defaultTitle')}
          </Text>
        </View>
      ),
    })
  }, [navigation, sessionId, terminal?.alias, terminal?.title, workspace?.alias, workspace?.name, t])

  useEffect(() => {
    if ((loadStatus === 'ok' || loadStatus === 'empty') && !terminal) {
      useClaudeStore.getState().setActiveSession(null)
      navigation.goBack()
    }
  }, [loadStatus, navigation, terminal])

  useEffect(() => {
    // Note: deliberately not calling Keyboard.scheduleLayoutAnimation here.
    // On the New Architecture (Fabric) LayoutAnimation drives a mount tick that
    // can crash in RCTPerformMountInstructions; we update the inset directly and
    // let the keyboard track without an interpolated layout animation.
    const updateKeyboardInset = (event: KeyboardEvent) => {
      const screenY = event.endCoordinates?.screenY
      const frameHeight = typeof screenY === 'number'
        ? Math.max(0, Dimensions.get('screen').height - screenY)
        : 0
      const fallbackHeight = Math.max(0, event.endCoordinates?.height ?? 0)
      setKeyboardHeight(frameHeight > 0 ? frameHeight : fallbackHeight)
    }

    const resetKeyboardInset = () => {
      setKeyboardHeight(0)
    }

    const subscriptions = Platform.OS === 'ios'
      ? [
          Keyboard.addListener('keyboardWillChangeFrame', updateKeyboardInset),
          Keyboard.addListener('keyboardWillHide', resetKeyboardInset),
        ]
      : [
          Keyboard.addListener('keyboardDidShow', updateKeyboardInset),
          Keyboard.addListener('keyboardDidHide', resetKeyboardInset),
        ]

    return () => {
      subscriptions.forEach(subscription => subscription.remove())
    }
  }, [])

  // Re-pull the host's live session state when the screen regains focus so
  // messages/status that changed while we were away show up. No archived
  // fallback: handleSessionState only replaces messages when the host returns
  // some, so this can't clobber the local conversation with a stale subset.
  const refreshSessionState = useCallback(async () => {
    if (!channels || !terminalCwd) return
    try {
      const state = await channels.claude.getSessionState(sessionId)
      if (!state) return
      useClaudeStore.getState().handleSessionState(sessionId, state)
      if (state.meta) {
        useClaudeStore.getState().handleStatus(sessionId, state.meta)
      }
    } catch (e) {
      dlog('CLAUDE_SCREEN', `focus refresh getSessionState error: ${e}`)
    }
  }, [channels, sessionId, terminalCwd])

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      useClaudeStore.getState().setActiveSession(sessionId)

      if (connectionStatus === 'connected') {
        dlog('CLAUDE_SCREEN', `focus health check sessionId=${sessionId}`)
        checkConnection().then(ok => {
          if (!cancelled) {
            dlog(ok ? 'CLAUDE_SCREEN' : '!CLAUDE_SCREEN', `focus health check result=${ok} sessionId=${sessionId}`)
          }
        }).catch(e => {
          dlog('!CLAUDE_SCREEN', `focus health check error sessionId=${sessionId}: ${e}`)
        })

        // Skip the first focus (the mount effect already loads/resumes the
        // session); on later refocuses, re-pull the live state.
        if (focusRefreshedRef.current) {
          refreshSessionState()
        } else {
          focusRefreshedRef.current = true
        }
      }

      return () => {
        cancelled = true
      }
    }, [checkConnection, connectionStatus, refreshSessionState, sessionId]),
  )

  // Init session in store and load history
  useEffect(() => {
    dlog('CLAUDE_SCREEN', `mount sessionId=${sessionId}`)
    dlog('CLAUDE_SCREEN', `terminal found: ${!!terminalCwd}, sdkSessionId=${terminalSdkSessionId}, agentPreset=${agentPreset}`)

    useClaudeStore.getState().initSession(sessionId)
    useClaudeStore.getState().setActiveSession(sessionId)

    const seq = ++loadSeqRef.current
    let cancelled = false
    let loadDeadlineTimer: ReturnType<typeof setTimeout> | null = null
    const finishLoading = () => {
      if (!cancelled && seq === loadSeqRef.current) {
        if (loadDeadlineTimer) {
          clearTimeout(loadDeadlineTimer)
          loadDeadlineTimer = null
        }
        setLoading(false)
      }
    }
    const setBackgroundHistoryLoading = (value: boolean) => {
      if (!cancelled && seq === loadSeqRef.current) {
        setHistoryLoadingInBackground(value)
      }
    }
    const reportLoadError = (value: null | 'connection' | 'missing') => {
      if (!cancelled && seq === loadSeqRef.current) {
        setLoadError(value)
      }
    }
    const timedLoadStep = async <T,>(label: string, run: () => Promise<T>): Promise<T> => {
      const startedAt = Date.now()
      dlog('CLAUDE_TIMING', `${label} started`)
      try {
        const result = await run()
        dlog('CLAUDE_TIMING', `${label} completed in ${Date.now() - startedAt}ms`)
        return result
      } catch (e) {
        dlog('!CLAUDE_TIMING', `${label} failed after ${Date.now() - startedAt}ms: ${e}`)
        throw e
      }
    }

    if (channels && terminalCwd) {
      setLoading(true)
      setBackgroundHistoryLoading(false)
      reportLoadError(null)
      loadDeadlineTimer = setTimeout(() => {
        dlog('CLAUDE_SCREEN', `initial history load still pending after ${INITIAL_LOAD_UI_TIMEOUT_MS}ms; showing session UI`)
        setBackgroundHistoryLoading(true)
        finishLoading()
      }, INITIAL_LOAD_UI_TIMEOUT_MS)
      const sandbox = terminalSandboxMode
      const approval = terminalApprovalPolicy
      const codexSandboxMode = sandbox === 'read-only' || sandbox === 'workspace-write' || sandbox === 'danger-full-access'
        ? sandbox
        : undefined
      const codexApprovalPolicy = approval === 'untrusted' || approval === 'on-request' || approval === 'never'
        ? approval
        : undefined
      // Worktree sessions must declare useWorktree + the host-side worktree
      // path so the host sidecar validates the folder and fails loudly when
      // it is missing instead of silently running in the original checkout.
      const worktreeOptions = terminalWorktreePath
        ? { useWorktree: true, worktreePath: terminalWorktreePath, worktreeBranch: terminalBranchName }
        : {}
      const buildLoadKey = (sdkSessionIdToResume: string | null) => JSON.stringify({
        sessionId,
        cwd: terminalCwd,
        sdkSessionId: sdkSessionIdToResume,
        model: terminalModel ?? null,
        agentPreset: agentPreset ?? null,
        codexSandboxMode: codexSandboxMode ?? null,
        codexApprovalPolicy: codexApprovalPolicy ?? null,
      })
      // Always-on load diagnostic (logged even with debug mode off, via the
      // '!' tag) so a "尚無訊息 but history should exist" report can be traced
      // from Settings → Share Debug Logs without a repro session over the wire.
      const diag: Record<string, unknown> = {
        sid: sessionId.slice(0, 8),
        preset: agentPreset ?? null,
        hasSdkId: !!terminalSdkSessionId,
        path: 'none',
      }
      const backfillArchivedHistory = async () => {
        const archived = await channels.claude.loadArchived(sessionId).catch(e => {
          dlog('CLAUDE_SCREEN', `loadArchived error: ${e}`)
          return null
        })
        const archivedMessages = Array.isArray(archived?.messages) ? archived.messages : []
        diag.archived = archivedMessages.length
        dlog('CLAUDE_SCREEN', `loadArchived messages=${archivedMessages.length} total=${archived?.total ?? 0}`)
        if (archivedMessages.length > 0) {
          useClaudeStore.getState().handleHistory(sessionId, archivedMessages as (ClaudeMessage | ClaudeToolCall)[])
        }
      }
      const loadSessionState = async (
        options?: { archivedFallback?: boolean },
      ): Promise<{ exists: boolean; liveCount: number; isStreaming: boolean }> => {
        const archivedFallback = options?.archivedFallback !== false
        try {
          const state = await timedLoadStep(
            `getSessionState sessionId=${sessionId}`,
            () => channels.claude.getSessionState(sessionId),
          )
          if (!state) {
            diag.gss = 'null'
            dlog('CLAUDE_SCREEN', `getSessionState returned null sessionId=${sessionId}`)
            return { exists: false, liveCount: 0, isStreaming: false }
          }
          const stateMessageCount = Array.isArray(state.messages) ? state.messages.length : 0
          diag.gss = {
            msgs: stateMessageCount,
            streaming: state.isStreaming === true,
            metaSdkId: !!state.meta?.sdkSessionId,
          }
          dlog('CLAUDE_SCREEN', `getSessionState messages=${stateMessageCount} streaming=${state.isStreaming === true}`)
          useClaudeStore.getState().handleSessionState(sessionId, state)
          if (state.meta) {
            useClaudeStore.getState().handleStatus(sessionId, state.meta)
          }
          if (stateMessageCount === 0 && archivedFallback) {
            await backfillArchivedHistory()
          }
          return { exists: true, liveCount: stateMessageCount, isStreaming: state.isStreaming === true }
        } catch (e) {
          dlog('CLAUDE_SCREEN', `getSessionState error: ${e}`)
          return { exists: false, liveCount: 0, isStreaming: false }
        }
      }
      const resumeWithSdkSessionId = async (sdkSessionIdToResume: string) => {
        const loadKey = buildLoadKey(sdkSessionIdToResume)
        if (loadedSessionKeyRef.current === loadKey || inFlightSessionKeyRef.current === loadKey) {
          dlog('CLAUDE_SCREEN', `skip duplicate history load sdkSessionId=${sdkSessionIdToResume}`)
          return
        }
        dlog('CLAUDE_SCREEN', `resuming session sdkSessionId=${sdkSessionIdToResume}`)
        inFlightSessionKeyRef.current = loadKey
        try {
          const resumeResult = await timedLoadStep(
            `resumeSession sessionId=${sessionId} sdkSessionId=${sdkSessionIdToResume}`,
            () => channels.claude.resumeSession(
              sessionId,
              sdkSessionIdToResume,
              terminalCwd,
              terminalModel,
              {
                agentPreset,
                ...(isClaudeCodeAgent ? { permissionMode } : {}),
                codexSandboxMode,
                codexApprovalPolicy,
                ...worktreeOptions,
              },
            ),
          )
          // Capture only the host's resume verdict (ok/stale/alreadyLive); the
          // payload may be large, so don't log it wholesale.
          diag.resume = resumeResult && typeof resumeResult === 'object'
            ? {
                ok: (resumeResult as Record<string, unknown>).ok ?? null,
                stale: (resumeResult as Record<string, unknown>).stale ?? null,
                alreadyLive: (resumeResult as Record<string, unknown>).alreadyLive ?? null,
              }
            : resumeResult ?? null
          // resumeSession pushes the full conversation via claude:history; never
          // run the archived fallback here or it clobbers that with a stale subset.
          await loadSessionState({ archivedFallback: false })
          loadedSessionKeyRef.current = loadKey
        } finally {
          if (inFlightSessionKeyRef.current === loadKey) {
            inFlightSessionKeyRef.current = null
          }
        }
      }

      const loadHistory = async () => {
        try {
          if (terminalSdkSessionId) {
            const state = await loadSessionState({ archivedFallback: false })
            // Never resume a session with a turn in flight: the host's
            // resumeSession aborts the running query, so merely opening the
            // view would kill the turn. A streaming session is attached by
            // definition — live events flow in without any resume.
            if (state.exists && (state.liveCount > 0 || state.isStreaming)) {
              diag.path = state.liveCount === 0 ? 'sdkId/live-backfill' : 'sdkId/live'
              dlog('CLAUDE_SCREEN', `loaded existing host state; skip resumeSession sdkSessionId=${terminalSdkSessionId} streaming=${state.isStreaming}`)
              // Mid-turn attach with the history archived away: resume is
              // off-limits, so backfill the prior conversation directly.
              if (state.liveCount === 0) await backfillArchivedHistory()
            } else {
              diag.path = 'sdkId/resume'
              dlog('CLAUDE_SCREEN', `no live host messages (liveCount=${state.liveCount}); resuming sdkSessionId=${terminalSdkSessionId}`)
              await resumeWithSdkSessionId(terminalSdkSessionId)
            }
          } else {
            dlog('CLAUDE_SCREEN', 'no sdkSessionId, trying getSessionMeta')
            let metaLoaded = false
            let stateLoaded = false
            try {
              const meta = await timedLoadStep(
                `getSessionMeta sessionId=${sessionId}`,
                () => channels.claude.getSessionMeta(sessionId),
              )
              if (meta) {
                metaLoaded = true
                useClaudeStore.getState().handleStatus(sessionId, meta)
                if (meta.sdkSessionId) {
                  // Same guard as the sdkSessionId path above: when the host
                  // session is already live (streaming or holding messages),
                  // attach read-only instead of resuming — resume tears down
                  // the running query.
                  const live = await loadSessionState({ archivedFallback: false })
                  if (live.exists && (live.liveCount > 0 || live.isStreaming)) {
                    diag.path = live.liveCount === 0 ? 'meta/live-backfill' : 'meta/live'
                    dlog('CLAUDE_SCREEN', `host session already live; skip resumeSession sdkSessionId=${meta.sdkSessionId} streaming=${live.isStreaming}`)
                    if (live.liveCount === 0) await backfillArchivedHistory()
                  } else {
                    diag.path = 'meta/resume'
                    await resumeWithSdkSessionId(meta.sdkSessionId)
                  }
                  return
                }
              }
            } catch (e) {
              dlog('CLAUDE_SCREEN', `getSessionMeta error: ${e}`)
            }
            stateLoaded = (await loadSessionState()).exists
            diag.path = metaLoaded ? 'meta/no-sdkId-state' : stateLoaded ? 'state-only' : 'fresh'
            if (!metaLoaded && !stateLoaded) {
              dlog('CLAUDE_SCREEN', 'no existing backend session, starting fresh')
              const loadKey = buildLoadKey(null)
              if (loadedSessionKeyRef.current !== loadKey && inFlightSessionKeyRef.current !== loadKey) {
                inFlightSessionKeyRef.current = loadKey
                try {
                  await timedLoadStep(
                    `startSession sessionId=${sessionId}`,
                    () => channels.claude.startSession(sessionId, {
                      cwd: terminalCwd,
                      ...(isClaudeCodeAgent ? { permissionMode } : {}),
                      model: terminalModel,
                      effort: effortLevel,
                      agentPreset,
                      codexSandboxMode,
                      codexApprovalPolicy,
                      ...worktreeOptions,
                    }),
                  )
                  loadedSessionKeyRef.current = loadKey
                } finally {
                  if (inFlightSessionKeyRef.current === loadKey) {
                    inFlightSessionKeyRef.current = null
                  }
                }
              }
            }
          }
        } catch (e) {
          diag.error = String(e)
          dlog('CLAUDE_SCREEN', `loadHistory error: ${e}`)
          // Tell the empty view why it's empty. "no rollout found" means the
          // host genuinely can't restore this conversation; everything else we
          // see in the wild (Not connected / Disconnected / invoke timeout) is
          // the socket dropping mid-load.
          const msg = String(e).toLowerCase()
          reportLoadError(msg.includes('no rollout') ? 'missing' : 'connection')
        } finally {
          diag.finalMsgs = useClaudeStore.getState().sessions[sessionId]?.messages.length ?? 0
          // '!' tag → always written, even with Debug Mode off, so the user can
          // reproduce once and Settings → Share Debug Logs to pinpoint why a
          // session loaded empty (no sdkSessionId? getSessionState null/empty?
          // resume stale?).
          dlog('!CLAUDE_DIAG', 'session load summary', diag)
          setBackgroundHistoryLoading(false)
          finishLoading()
        }
      }
      loadHistory()
    } else {
      setBackgroundHistoryLoading(false)
      finishLoading()
    }
    return () => {
      cancelled = true
      if (loadDeadlineTimer) {
        clearTimeout(loadDeadlineTimer)
      }
    }
  }, [
    channels,
    sessionId,
    terminalCwd,
    terminalSdkSessionId,
    terminalModel,
    terminalWorktreePath,
    terminalBranchName,
    terminalSandboxMode,
    terminalApprovalPolicy,
    agentPreset,
    isClaudeCodeAgent,
    permissionMode,
    effortLevel,
  ])

  // Fetch usage on mount and poll every 60s
  useEffect(() => {
    if (!channels) return
    const fetchUsage = () => {
      channels.claude.getContextUsage(sessionId).then((u: any) => {
        if (u) setUsage(u)
      }).catch(() => {})
    }
    fetchUsage()
    const timer = setInterval(fetchUsage, 60_000)
    return () => clearInterval(timer)
  }, [channels, sessionId])

  // Sync permission mode from meta
  useEffect(() => {
    if (session.meta?.permissionMode) {
      setPermissionMode(session.meta.permissionMode)
    }
  }, [session.meta?.permissionMode])

  useEffect(() => {
    if (!channels) return
    let cancelled = false
    channels.claude.getSupportedEfforts(sessionId)
      .then(raw => {
        if (!cancelled) setSupportedEffortOptions(normalizeStringOptions(raw))
      })
      .catch(() => {
        if (!cancelled) setSupportedEffortOptions([])
      })

    if (isCodexAgent) {
      channels.claude.getSupportedCodexSandboxModes(sessionId)
        .then(raw => {
          if (!cancelled) setSupportedSandboxOptions(normalizeStringOptions(raw))
        })
        .catch(() => {
          if (!cancelled) setSupportedSandboxOptions([])
        })
      channels.claude.getSupportedCodexApprovalPolicies(sessionId)
        .then(raw => {
          if (!cancelled) setSupportedApprovalOptions(normalizeStringOptions(raw))
        })
        .catch(() => {
          if (!cancelled) setSupportedApprovalOptions([])
        })
    } else {
      setSupportedSandboxOptions([])
      setSupportedApprovalOptions([])
    }

    return () => {
      cancelled = true
    }
  }, [channels, isCodexAgent, sessionId])

  useEffect(() => {
    if (!(effortOptions as readonly string[]).includes(effortLevel)) {
      setEffortLevel(effortOptions[0] ?? 'high')
    }
  }, [effortLevel, effortOptions])

  useEffect(() => {
    if (isCodexAgent && !sandboxOptions.includes(codexSandboxMode)) {
      setCodexSandboxMode(sandboxOptions[0] ?? 'workspace-write')
    }
  }, [codexSandboxMode, isCodexAgent, sandboxOptions])

  useEffect(() => {
    if (isCodexAgent && !approvalOptions.includes(codexApprovalPolicy)) {
      setCodexApprovalPolicy(approvalOptions[0] ?? 'on-request')
    }
  }, [approvalOptions, codexApprovalPolicy, isCodexAgent])

  useEffect(() => {
    const sandbox = terminal?.agentParams?.sandboxMode
    if (sandbox === 'read-only' || sandbox === 'workspace-write' || sandbox === 'danger-full-access') {
      setCodexSandboxMode(sandbox)
    }
    const approval = terminal?.agentParams?.approvalPolicy
    if (approval === 'untrusted' || approval === 'on-request' || approval === 'never') {
      setCodexApprovalPolicy(approval)
    }
  }, [terminal?.agentParams])

  const handleSend = useCallback(async () => {
    if (sendInFlightRef.current) return
    if ((!inputText.trim() && attachedImages.length === 0) || !channels) return
    sendInFlightRef.current = true
    const text = inputText.trim()

    // Handle /new command
    if (text === '/new') {
      setInputText('')
      channels.claude.resetSession(sessionId)
        .then(() => {
          useChatFilterStore.getState().clearSession(sessionId)
        })
        .catch(e => {
          console.warn('[Claude] resetSession error:', e)
        })
        .finally(() => {
          sendInFlightRef.current = false
        })
      return
    }

    // Handle /resume command
    if (text === '/resume') {
      setInputText('')
      if (!terminal?.cwd) {
        sendInFlightRef.current = false
        return
      }
      setResumeLoading(true)
      setShowResumeList(true)
      try {
        const sessions = isOpenAIAgent
          ? await channels.openai.listSessions(terminal.cwd)
          : await channels.claude.listSessions(terminal.cwd, isCodexAgent ? 'codex' : undefined)
        setResumeSessions(normalizeSessionSummaries(sessions))
      } catch {
        setResumeSessions([])
      } finally {
        setResumeLoading(false)
        sendInFlightRef.current = false
      }
      return
    }

    const images = attachedImages.map(img => img.dataUrl)
    setInputText('')
    setAttachedImages([])

    // Images above ~2 MiB are streamed to the host's tmp dir and referenced
    // by host path (the agent reads them from disk); smaller ones stay inline
    // as data URLs. Upload failures fall back to inline.
    const inlineImages: string[] = []
    const hostPaths: string[] = []
    for (const dataUrl of images) {
      const commaIndex = dataUrl.indexOf(',')
      const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : ''
      if (base64.length <= MAX_INLINE_IMAGE_BASE64_CHARS) {
        inlineImages.push(dataUrl)
        continue
      }
      const ext = /^data:image\/png/.test(dataUrl) ? 'png' : 'jpg'
      try {
        hostPaths.push(await channels.fs.uploadToHostTmp(`photo-${Date.now()}.${ext}`, base64))
      } catch (e) {
        console.warn('[Claude] uploadToHostTmp failed, sending inline:', e)
        inlineImages.push(dataUrl)
      }
    }

    const messageText = hostPaths.length > 0
      ? [text, ...hostPaths.map(p => `[attached image: ${p}]`)].filter(Boolean).join('\n')
      : text

    const contentParts: string[] = []
    if (text) contentParts.push(text)
    if (images.length > 0) contentParts.push(`[${images.length} image${images.length > 1 ? 's' : ''} attached]`)

    const sendImages = inlineImages.length > 0 ? inlineImages : undefined
    const localId = `user-local-${Date.now()}`
    useClaudeStore.getState().handleMessage(sessionId, {
      id: localId,
      sessionId,
      role: 'user',
      content: contentParts.join('\n'),
      timestamp: Date.now(),
      status: 'sending',
      sendPayload: { messageText, images: sendImages },
    })

    channels.claude.sendMessage(sessionId, messageText, sendImages)
      .then(() => {
        // Host acked receipt (invoke-result) → solidify the ghosted message.
        useClaudeStore.getState().setUserMessageStatus(sessionId, localId, 'sent')
      })
      .catch(e => {
        // invoke-error or timeout → the send did not land; surface it so the
        // user notices instead of assuming it was delivered.
        console.warn('[Claude] sendMessage error:', e)
        useClaudeStore.getState().setUserMessageStatus(sessionId, localId, 'failed')
      })
      .finally(() => {
        sendInFlightRef.current = false
      })
  }, [inputText, attachedImages, channels, sessionId, terminal?.cwd, isOpenAIAgent, isCodexAgent])

  const openResumeList = useCallback(async () => {
    if (!channels || !terminal?.cwd) return
    setResumeLoading(true)
    setShowResumeList(true)
    try {
      const sessions = isOpenAIAgent
        ? await channels.openai.listSessions(terminal.cwd)
        : await channels.claude.listSessions(terminal.cwd, isCodexAgent ? 'codex' : undefined)
      setResumeSessions(normalizeSessionSummaries(sessions))
    } catch (e) {
      dlog('CLAUDE_SCREEN', `listSessions error: ${e}`)
      setResumeSessions([])
    } finally {
      setResumeLoading(false)
    }
  }, [channels, terminal?.cwd, isOpenAIAgent, isCodexAgent])

  // Esc-key replacement: tap once = soft stop (stop & wait for input),
  // double-tap within 500ms = hard abort (fully interrupt), mirroring the
  // desktop's single-vs-double Esc behavior.
  const lastStopTapRef = useRef(0)
  const stopArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [stopArmed, setStopArmed] = useState(false)

  useEffect(() => () => {
    if (stopArmTimerRef.current) clearTimeout(stopArmTimerRef.current)
  }, [])

  const handleStop = useCallback(async () => {
    if (!channels) return
    const now = Date.now()
    const isDoubleTap = now - lastStopTapRef.current < 500
    lastStopTapRef.current = now
    if (stopArmTimerRef.current) {
      clearTimeout(stopArmTimerRef.current)
      stopArmTimerRef.current = null
    }
    if (isDoubleTap) {
      setStopArmed(false)
      await channels.claude.abortSession(sessionId)
    } else {
      setStopArmed(true)
      stopArmTimerRef.current = setTimeout(() => setStopArmed(false), 500)
      await channels.claude.stopSession(sessionId)
    }
  }, [channels, sessionId])

  const handlePermissionCycle = useCallback(async () => {
    if (!channels) return
    const idx = PERMISSION_MODES.indexOf(permissionMode as typeof PERMISSION_MODES[number])
    const next = PERMISSION_MODES[(idx + 1) % PERMISSION_MODES.length]
    try {
      await channels.claude.setPermissionMode(sessionId, next)
      setPermissionMode(next)
    } catch (e) {
      Alert.alert(t('claude.errors.switchPermissionFailed'), String(e))
    }
  }, [channels, sessionId, permissionMode, t])

  const handleEffortSelect = useCallback(async (effort: string) => {
    if (!channels) return
    setShowEffortPicker(false)
    try {
      await channels.claude.setEffort(sessionId, effort)
      setEffortLevel(effort)
    } catch (e) {
      Alert.alert(t('claude.errors.switchEffortFailed'), String(e))
    }
  }, [channels, sessionId, t])

  const handleCodexSandboxSelect = useCallback(async (mode: string) => {
    if (!channels) return
    setShowSandboxPicker(false)
    try {
      await channels.claude.setCodexSandboxMode(sessionId, mode)
      setCodexSandboxMode(mode)
    } catch (e) {
      Alert.alert(t('claude.errors.switchSandboxFailed'), String(e))
    }
  }, [channels, sessionId, t])

  const handleCodexApprovalSelect = useCallback(async (policy: string) => {
    if (!channels) return
    setShowApprovalPicker(false)
    try {
      await channels.claude.setCodexApprovalPolicy(sessionId, policy)
      setCodexApprovalPolicy(policy)
    } catch (e) {
      Alert.alert(t('claude.errors.switchApprovalFailed'), String(e))
    }
  }, [channels, sessionId, t])

  const handleCompact = useCallback(async () => {
    if (!channels) return
    await channels.openai.compactNow(sessionId)
  }, [channels, sessionId])

  const openCodexAccountPicker = useCallback(async () => {
    if (!channels) return
    setShowCodexAccountPicker(true)
    setCodexAccountsLoading(true)
    try {
      const result = await channels.claude.codexAccountList()
      setCodexAccounts(Array.isArray(result?.accounts) ? result.accounts : [])
    } catch (e) {
      setCodexAccounts([])
      dlog('CLAUDE_SCREEN', `codexAccountList error: ${e}`)
    } finally {
      setCodexAccountsLoading(false)
    }
  }, [channels])

  const handleCodexAccountSelect = useCallback(async (entry: CodexAccountEntry) => {
    if (!channels) return
    setShowCodexAccountPicker(false)
    if (entry.active) return
    try {
      await channels.claude.codexAccountSwitch(entry.id)
    } catch (e) {
      Alert.alert('Unable to switch Codex account', String(e))
    }
  }, [channels])

  const handleModelPress = useCallback(async () => {
    if (!channels) return
    try {
      const models = await channels.claude.getSupportedModels(sessionId)
      setAvailableModels(normalizeModelOptions(models))
      setShowModelPicker(true)
    } catch (e) {
      console.warn('[Claude] getSupportedModels error:', e)
      Alert.alert(t('claude.errors.loadModelsFailed'), String(e))
    }
  }, [channels, sessionId, t])

  const handleModelSelect = useCallback(async (model: ModelOption) => {
    if (!channels) return
    setShowModelPicker(false)
    try {
      const { model: resolvedModel, autoCompactWindow } = setModelArgsForClaudeSelection(model.value)
      await channels.claude.setModel(sessionId, resolvedModel, autoCompactWindow)
    } catch (e) {
      console.warn('[Claude] setModel error:', e)
      Alert.alert(t('claude.errors.switchModelFailed'), String(e))
    }
  }, [channels, sessionId, t])

  const handleFork = useCallback(async () => {
    if (!channels) return
    try {
      await channels.claude.forkSession(sessionId)
      useChatFilterStore.getState().clearSession(sessionId)
    } catch (e) {
      console.warn('[Claude] fork error:', e)
    }
  }, [channels, sessionId])

  const handleResumeSelect = useCallback(async (sdkSessionId: string) => {
    if (!channels || !terminal) return
    setShowResumeList(false)
    setResumeSessions([])
    setHistoryLoadingInBackground(true)
    try {
      await channels.claude.resumeSession(sessionId, sdkSessionId, terminal.cwd, terminal.model, {
        agentPreset,
        ...(isClaudeCodeAgent ? { permissionMode } : {}),
        effort: effortLevel,
        codexSandboxMode,
        codexApprovalPolicy,
        ...(terminal.worktreePath
          ? { useWorktree: true, worktreePath: terminal.worktreePath, worktreeBranch: terminal.branchName }
          : {}),
      })
      useChatFilterStore.getState().clearSession(sessionId)
    } catch (e) {
      setHistoryLoadingInBackground(false)
      Alert.alert(t('claude.errors.resumeSessionFailed'), String(e))
      return
    }
    try {
      // resumeSession pushes the full conversation via claude:history. Only refresh
      // meta/status from getSessionState here; do NOT fall back to loadArchived, which
      // returns a stale newest-N subset that would clobber the freshly-pushed history.
      const state = await channels.claude.getSessionState(sessionId)
      const stateMessageCount = Array.isArray(state?.messages) ? state.messages.length : 0
      dlog('CLAUDE_SCREEN', `resumeSelect getSessionState messages=${stateMessageCount} sdkSessionId=${sdkSessionId}`)
      if (state) {
        useClaudeStore.getState().handleSessionState(sessionId, state)
        if (state.meta) {
          useClaudeStore.getState().handleStatus(sessionId, state.meta)
        }
      }
    } catch (e) {
      dlog('CLAUDE_SCREEN', `resumeSelect getSessionState error: ${e}`)
    } finally {
      setHistoryLoadingInBackground(false)
    }
  }, [channels, sessionId, terminal, agentPreset, isClaudeCodeAgent, permissionMode, effortLevel, codexSandboxMode, codexApprovalPolicy, t])

  const handleUpload = useCallback(() => {
    if (attachedImages.length >= MAX_IMAGES) {
      Alert.alert(t('claude.errors.imageLimitTitle'), t('claude.errors.imageLimitMessage', { max: MAX_IMAGES }))
      return
    }
    try {
      launchImageLibrary(
        {
          mediaType: 'photo',
          selectionLimit: MAX_IMAGES - attachedImages.length,
          includeBase64: true,
          quality: 0.8,
          maxWidth: 2048,
          maxHeight: 2048,
        },
        (response) => {
          if (response.didCancel || response.errorCode) return
          const newImages = (response.assets || [])
            .filter(a => a.base64 && a.uri)
            .map(a => ({
              uri: a.uri!,
              dataUrl: `data:${a.type || 'image/jpeg'};base64,${a.base64}`,
            }))
          if (newImages.length > 0) {
            setAttachedImages(prev => [...prev, ...newImages].slice(0, MAX_IMAGES))
          }
        },
      )
    } catch {
      Alert.alert(t('claude.errors.rebuildRequiredTitle'), t('claude.errors.rebuildRequiredMessage'))
    }
  }, [attachedImages.length, t])

  const removeImage = useCallback((index: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  const kindCounts = useMemo(() => {
    const counts: Record<ChatItemKind, number> = { you: 0, message: 0, tool: 0, thinking: 0 }
    for (const item of session.messages) {
      const kind = classifyChatItem(item)
      if (kind) counts[kind]++
    }
    return counts
  }, [session.messages])

  const filteredEntries = useMemo<ListEntry[]>(() => {
    const out: ListEntry[] = []
    let pending: { itemKind: ChatItemKind; count: number; firstId: string } | null = null

    const flush = () => {
      if (!pending) return
      out.push({
        kind: 'placeholder',
        itemKind: pending.itemKind,
        count: pending.count,
        id: `ph-${pending.itemKind}-${pending.firstId}`,
      })
      pending = null
    }

    for (const item of session.messages) {
      const itemKind = classifyChatItem(item)
      if (itemKind && !chatFilters[itemKind]) {
        if (pending !== null && pending.itemKind === itemKind) {
          pending.count++
        } else {
          flush()
          pending = { itemKind, count: 1, firstId: item.id }
        }
      } else {
        flush()
        out.push({ kind: 'item', data: item })
      }
    }
    flush()
    return out
  }, [chatFilters, session.messages])

  const renderItem = useCallback(({ item }: { item: ListEntry }) => {
    if (item.kind === 'placeholder') {
      return (
        <HiddenBlocksPlaceholder
          kind={item.itemKind}
          count={item.count}
          onPress={() => setChatFilterKind(sessionId, item.itemKind, true)}
        />
      )
    }
    if (isToolCall(item.data)) {
      return <ToolCallCard tool={item.data} />
    }
    return <MessageBubble message={item.data} />
  }, [sessionId, setChatFilterKind])

  const showStreaming = session.isStreaming && (session.streamingText || session.streamingThinking)

  // Inverted FlatList: data is reversed so newest = index 0 = visible at bottom
  const invertedItems = useMemo(() => [...filteredEntries].reverse(), [filteredEntries])

  const handleScrollToBottomPress = useCallback(() => {
    isAtBottomRef.current = true
    setShowFab(false)
    // In inverted list, "bottom" is offset 0
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
  }, [])

  const handleScroll = useCallback((e: any) => {
    const { contentOffset } = e.nativeEvent
    // In inverted list, "at bottom" means near offset 0
    const atBottom = contentOffset.y < 80
    isAtBottomRef.current = atBottom
    setShowFab(!atBottom)
  }, [])

  const modeColor = permissionMode === 'bypassPermissions' || permissionMode === 'planBypass'
    ? appColors.error : appColors.textSecondary

  const sdkSessionShort = terminal?.sdkSessionId
    ? terminal.sdkSessionId.slice(0, 8) : null

  return (
    <View style={styles.container}>
      <SessionContextBar
        workspaceId={terminal?.workspaceId}
        detail={terminal?.cwd}
      />
      <ChatFilterStrip sessionId={sessionId} counts={kindCounts} />
      {/* Message list */}
      <View style={styles.listContainer}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={agentColor} />
            <Text style={styles.loadingText}>{t('claude.loading.session')}</Text>
          </View>
        ) : invertedItems.length === 0 && !showStreaming ? (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyIcon, { color: loadError ? appColors.error : agentColor }]}>
              {loadError ? '\u26A0' : isCodexAgent ? '\u2B21' : '\u2726'}
            </Text>
            <Text style={styles.emptyText}>
              {loadError === 'connection'
                ? t('claude.empty.loadFailed')
                : loadError === 'missing'
                  ? t('claude.empty.historyUnavailable')
                  : historyLoadingInBackground
                    ? t('claude.empty.syncingHistory')
                    : t('claude.empty.noMessages')}
            </Text>
            <Text style={styles.emptySubtext}>
              {loadError === 'connection'
                ? t('claude.empty.loadFailedHint')
                : loadError === 'missing'
                  ? t('claude.empty.historyUnavailableHint')
                  : historyLoadingInBackground
                    ? t('claude.empty.historyLoadingBackground')
                    : t('claude.empty.startConversation')}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={invertedItems}
            renderItem={renderItem}
            inverted
            contentContainerStyle={styles.listContent}
            keyExtractor={(entry) => entry.kind === 'placeholder' ? entry.id : entry.data.id}
            onScroll={handleScroll}
            scrollEventThrottle={200}
            ListHeaderComponent={showStreaming ? (
              <StreamingText text={session.streamingText} thinking={session.streamingThinking} />
            ) : null}
          />
        )}
        {/* Scroll to bottom FAB */}
        {showFab && invertedItems.length > 0 && (
          <TouchableOpacity style={[styles.scrollFab, { backgroundColor: agentColor }]} onPress={handleScrollToBottomPress} activeOpacity={0.8}>
            <Text style={styles.scrollFabText}>{'\u2193'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Input area */}
      <View
        style={[
          styles.inputArea,
          {
            marginBottom: keyboardBottomInset,
            paddingBottom: inputAreaPaddingBottom,
          },
        ]}
      >
        {/* Host-side turn status: working / thinking / responding / waiting,
            spanning the whole turn with an elapsed counter. */}
        <RuntimeStatusBar
          runtimeStatus={session.meta?.runtimeStatus ?? null}
          runtimeSince={session.runtimeStatusSince}
          turnStartedAt={session.turnStartedAt}
          responding={!!session.streamingText}
          thinking={!!session.streamingThinking}
        />

        {/* Prompt suggestions */}
        {promptSuggestions.length > 0 && !session.isStreaming && (
          <View style={styles.suggestions}>
            {promptSuggestions.map((s, i) => (
              <TouchableOpacity
                key={i}
                style={styles.suggestionChip}
                onPress={() => setInputText(s)}
              >
                <Text style={styles.suggestionLabel}>{t('claude.suggestion.label')}</Text>
                <Text style={styles.suggestionText} numberOfLines={1}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Attached images thumbnails */}
        {attachedImages.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbStrip} contentContainerStyle={styles.thumbStripContent}>
            {attachedImages.map((img, i) => (
              <View key={i} style={styles.thumbWrap}>
                <TouchableOpacity activeOpacity={0.8} onPress={() => setPreviewImageUri(img.uri)}>
                  <Image source={{ uri: img.uri }} style={styles.thumbImage} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.thumbRemove} onPress={() => removeImage(i)}>
                  <Text style={styles.thumbRemoveText}>{'\u2715'}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Input row */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={isCodexAgent ? t('claude.input.placeholderCodex') : t('claude.input.placeholderClaude')}
            placeholderTextColor={appColors.textMuted}
            multiline
            maxLength={100000}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.sendButton, { backgroundColor: agentColor }, (!inputText.trim() && attachedImages.length === 0) && styles.sendDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() && attachedImages.length === 0}
          >
            <Text style={styles.sendText}>{'\u2191'}</Text>
          </TouchableOpacity>
        </View>

        {/* Controls row: mode / model / effort / fork / upload */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.controlsScroll}
          contentContainerStyle={styles.controlsContent}
        >
          {isClaudeCodeAgent && (
            <TouchableOpacity style={styles.controlBtn} onPress={handlePermissionCycle}>
              <Text style={[styles.controlText, { color: modeColor }]}>
                {PERMISSION_LABELS[permissionMode] || permissionMode}
              </Text>
            </TouchableOpacity>
          )}

          {session.meta?.model && (
            <TouchableOpacity style={styles.controlBtn} onPress={handleModelPress}>
              <Text style={styles.controlText}>{'</>'} {session.meta.model}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.controlBtn} onPress={() => setShowEffortPicker(true)}>
            <Text style={styles.controlText}>
              {isCodexAgent
                ? t('claude.controls.thinking', { value: effortLevel })
                : t('claude.controls.effort', { value: effortLevel })}
            </Text>
          </TouchableOpacity>

          {isCodexAgent && (
            <>
              <TouchableOpacity style={styles.controlBtn} onPress={() => setShowSandboxPicker(true)}>
                <Text style={styles.controlText}>{t('claude.controls.sandbox', { value: codexSandboxMode })}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.controlBtn} onPress={() => setShowApprovalPicker(true)}>
                <Text style={styles.controlText}>{t('claude.controls.approval', { value: codexApprovalPolicy })}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.controlBtn} onPress={openCodexAccountPicker}>
                <Text style={styles.controlText}>account</Text>
              </TouchableOpacity>
            </>
          )}

          {isOpenAIAgent && (
            <TouchableOpacity style={styles.controlBtn} onPress={handleCompact}>
              <Text style={styles.controlText}>{t('claude.controls.compact')}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.controlBtn} onPress={handleFork}>
            <Text style={styles.controlText}>{'\u2442'} {t('claude.controls.fork')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlBtn} onPress={handleUpload}>
            <Text style={styles.controlText}>
              {attachedImages.length > 0 ? `\uD83D\uDCCE ${attachedImages.length}/${MAX_IMAGES}` : '\uD83D\uDCCE'}
            </Text>
          </TouchableOpacity>

          {session.isStreaming && (
            <TouchableOpacity
              style={[styles.controlBtn, { backgroundColor: stopArmed ? appColors.warning : appColors.error, borderColor: stopArmed ? appColors.warning : appColors.error }]}
              onPress={handleStop}
            >
              <Text style={[styles.controlText, { color: '#fff', fontWeight: '700' }]}>
                {stopArmed ? t('claude.controls.stopAgain') : t('claude.controls.stop')}
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Status + usage info row */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.infoScroll} contentContainerStyle={styles.infoContent}>
          {session.meta && (
            <Text style={styles.infoText}>${session.meta.totalCost?.toFixed(4) ?? '0'}</Text>
          )}
          {session.meta && session.meta.inputTokens > 0 && (
            <Text style={styles.infoText}>
              {Math.round((session.meta.inputTokens + session.meta.outputTokens) / 1000)}k tok
            </Text>
          )}
          {usage?.fiveHour != null && (
            <Text style={[styles.infoText, usage.fiveHour > 80 && styles.usageHigh]}>
              5h:{Math.round(usage.fiveHour)}%
              {usage.fiveHourReset ? ` \u21BB${fmtRemaining(new Date(usage.fiveHourReset))}` : ''}
            </Text>
          )}
          {usage?.sevenDay != null && (
            <Text style={[styles.infoText, (usage.sevenDay ?? 0) > 80 && styles.usageHigh]}>
              7d:{Math.round(usage.sevenDay ?? 0)}%
              {usage.sevenDayReset ? ` \u21BB${fmtRemaining(new Date(usage.sevenDayReset))}` : ''}
            </Text>
          )}
          {sdkSessionShort && (
            <TouchableOpacity style={styles.infoChip} onPress={openResumeList}>
              <Text style={[styles.infoText, styles.infoTextClickable]}>sid:{sdkSessionShort}</Text>
            </TouchableOpacity>
          )}
          {terminal?.cwd && (
            <Text style={styles.infoText} numberOfLines={1}>
              {terminal.cwd.split('/').slice(-2).join('/')}
            </Text>
          )}
        </ScrollView>
      </View>

      {/* Model picker modal */}
      <Modal visible={showModelPicker} transparent animationType="fade" onRequestClose={() => setShowModelPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowModelPicker(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('claude.modal.selectModel')}</Text>
            <FlatList
              data={availableModels}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modelItem, item.value === session.meta?.model && { backgroundColor: agentSelectedBg }]}
                  onPress={() => handleModelSelect(item)}
                >
                  <View style={styles.modelLabelWrap}>
                    <Text style={[styles.modelItemText, item.value === session.meta?.model && { color: agentColor }]}>
                      {item.displayName}
                    </Text>
                    <Text style={styles.modelValueText}>{item.value}</Text>
                    {item.description ? (
                      <Text style={styles.modelDescriptionText}>{item.description}</Text>
                    ) : null}
                  </View>
                  {item.value === session.meta?.model && (
                    <Text style={[styles.modelCheck, { color: agentColor }]}>{'\u2713'}</Text>
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Effort / thinking picker modal */}
      <Modal visible={showEffortPicker} transparent animationType="fade" onRequestClose={() => setShowEffortPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowEffortPicker(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{isCodexAgent ? t('claude.modal.selectThinking') : t('claude.modal.selectEffort')}</Text>
            <FlatList
              data={effortOptions}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modelItem, item === effortLevel && { backgroundColor: agentSelectedBg }]}
                  onPress={() => handleEffortSelect(item)}
                >
                  <Text style={[styles.modelItemText, item === effortLevel && { color: agentColor }]}>
                    {isCodexAgent
                      ? t('claude.modal.thinkingOption', { value: item })
                      : t('claude.modal.effortOption', { value: item })}
                  </Text>
                  {item === effortLevel && (
                    <Text style={[styles.modelCheck, { color: agentColor }]}>{'\u2713'}</Text>
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Codex sandbox picker modal */}
      <Modal visible={showSandboxPicker} transparent animationType="fade" onRequestClose={() => setShowSandboxPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowSandboxPicker(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('claude.modal.selectSandbox')}</Text>
            <FlatList
              data={sandboxOptions}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modelItem, item === codexSandboxMode && { backgroundColor: agentSelectedBg }]}
                  onPress={() => handleCodexSandboxSelect(item)}
                >
                  <Text style={[styles.modelItemText, item === codexSandboxMode && { color: agentColor }]}>
                    {t('claude.modal.sandboxOption', { value: item })}
                  </Text>
                  {item === codexSandboxMode && (
                    <Text style={[styles.modelCheck, { color: agentColor }]}>{'\u2713'}</Text>
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Codex approval picker modal */}
      <Modal visible={showApprovalPicker} transparent animationType="fade" onRequestClose={() => setShowApprovalPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowApprovalPicker(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('claude.modal.selectApproval')}</Text>
            <FlatList
              data={approvalOptions}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modelItem, item === codexApprovalPolicy && { backgroundColor: agentSelectedBg }]}
                  onPress={() => handleCodexApprovalSelect(item)}
                >
                  <Text style={[styles.modelItemText, item === codexApprovalPolicy && { color: agentColor }]}>
                    {t('claude.modal.approvalOption', { value: item })}
                  </Text>
                  {item === codexApprovalPolicy && (
                    <Text style={[styles.modelCheck, { color: agentColor }]}>{'\u2713'}</Text>
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Codex account picker modal */}
      <Modal visible={showCodexAccountPicker} transparent animationType="fade" onRequestClose={() => setShowCodexAccountPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowCodexAccountPicker(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Codex Account</Text>
            {codexAccountsLoading ? (
              <ActivityIndicator style={{ margin: 16 }} />
            ) : codexAccounts.length === 0 ? (
              <Text style={[styles.modelItemText, { padding: 16 }]}>No signed-in Codex accounts on host</Text>
            ) : (
              <FlatList
                data={codexAccounts}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.modelItem, item.active && { backgroundColor: agentSelectedBg }]}
                    onPress={() => handleCodexAccountSelect(item)}
                  >
                    <Text style={[styles.modelItemText, item.active && { color: agentColor }]}>
                      {item.label || item.email || item.id}
                      {item.authenticated === false ? ' (needs login)' : ''}
                    </Text>
                    {item.active && (
                      <Text style={[styles.modelCheck, { color: agentColor }]}>{'✓'}</Text>
                    )}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Image preview modal */}
      <Modal visible={!!previewImageUri} transparent animationType="fade" onRequestClose={() => setPreviewImageUri(null)}>
        <TouchableOpacity style={styles.imagePreviewOverlay} activeOpacity={1} onPress={() => setPreviewImageUri(null)}>
          {previewImageUri && (
            <Image source={{ uri: previewImageUri }} style={styles.imagePreviewFull} resizeMode="contain" />
          )}
        </TouchableOpacity>
      </Modal>

      {/* Resume session list modal */}
      <Modal visible={showResumeList} transparent animationType="fade" onRequestClose={() => setShowResumeList(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowResumeList(false)}>
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>{t('claude.resume.title')}</Text>
            {resumeLoading ? (
              <View style={styles.resumeEmpty}>
                <ActivityIndicator size="small" color={appColors.accent} />
                <Text style={styles.resumeEmptyText}>{t('claude.resume.loading')}</Text>
              </View>
            ) : resumeSessions.length === 0 ? (
              <View style={styles.resumeEmpty}>
                <Text style={styles.resumeEmptyText}>{t('claude.resume.noSessions')}</Text>
              </View>
            ) : (
              <FlatList
                data={resumeSessions}
                keyExtractor={(item) => item.sdkSessionId}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.resumeItem}
                    onPress={() => handleResumeSelect(item.sdkSessionId)}
                  >
                    <View style={styles.resumeItemHeader}>
                      <Text style={styles.resumeItemId}>{item.sdkSessionId.slice(0, 8)}</Text>
                      {item.gitBranch && (
                        <Text style={styles.resumeItemBranch}>{item.gitBranch}</Text>
                      )}
                      <Text style={styles.resumeItemTime}>
                        {new Date(item.createdAt || item.timestamp).toLocaleString()}
                      </Text>
                    </View>
                    {item.customTitle && (
                      <Text style={styles.resumeItemTitle} numberOfLines={1}>{item.customTitle}</Text>
                    )}
                    {item.summary && item.summary !== item.customTitle && (
                      <Text style={styles.resumeItemPreview} numberOfLines={2}>{item.summary}</Text>
                    )}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appColors.background,
  },
  headerTitleWrap: {
    minWidth: 0,
  },
  headerBackButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBackText: {
    color: appColors.text,
    fontSize: 28,
    lineHeight: 32,
  },
  headerTitle: {
    color: appColors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
  },
  headerButton: {
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  headerButtonText: {
    color: appColors.accent,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  // ---- Status bar (top) ----
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  statusScroll: {
    flex: 1,
  },
  statusText: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontFamily: 'monospace',
  },
  statusSep: {
    fontSize: fontSize.xs,
    color: appColors.textMuted,
    marginHorizontal: spacing.xs,
  },
  stopButton: {
    backgroundColor: appColors.error,
    borderRadius: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginLeft: spacing.sm,
  },
  stopText: {
    fontSize: fontSize.xs,
    color: '#fff',
    fontWeight: '700',
  },
  // ---- Message list ----
  listContainer: {
    flex: 1,
  },
  listContent: {
    padding: spacing.lg,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: fontSize.md,
    color: appColors.textSecondary,
    marginTop: spacing.md,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  emptyIcon: {
    fontSize: 48,
    color: appColors.accent,
    marginBottom: spacing.md,
  },
  emptyText: {
    fontSize: fontSize.lg,
    color: appColors.text,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  emptySubtext: {
    fontSize: fontSize.md,
    color: appColors.textSecondary,
    textAlign: 'center',
  },
  scrollFab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: appColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    zIndex: 10,
  },
  scrollFabText: {
    fontSize: fontSize.lg,
    color: '#fff',
    fontWeight: '700',
  },
  // ---- Input area (bottom) ----
  inputArea: {
    borderTopWidth: 1,
    borderTopColor: appColors.border,
    backgroundColor: appColors.surface,
    paddingBottom: spacing.lg,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 0,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: appColors.background,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: appColors.accent,
  },
  suggestionLabel: {
    fontSize: fontSize.xs,
    color: appColors.accent,
    fontWeight: '600',
    marginRight: spacing.xs,
  },
  suggestionText: {
    fontSize: fontSize.sm,
    color: appColors.text,
    flexShrink: 1,
  },
  thumbStrip: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  thumbStripContent: {
    paddingHorizontal: spacing.md,
  },
  thumbWrap: {
    width: 60,
    height: 60,
    marginRight: spacing.sm,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: appColors.border,
  },
  thumbImage: {
    width: 60,
    height: 60,
  },
  thumbRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '700',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  input: {
    flex: 1,
    backgroundColor: appColors.background,
    borderRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingVertical: Platform.OS === 'android' ? spacing.md : spacing.sm,
    fontSize: fontSize.md,
    color: appColors.text,
    maxHeight: 120,
    minHeight: 40,
    borderWidth: 1,
    borderColor: appColors.border,
    textAlignVertical: 'center',
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: appColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  sendDisabled: {
    opacity: 0.4,
  },
  sendText: {
    fontSize: fontSize.lg,
    color: '#fff',
    fontWeight: '700',
  },
  // ---- Controls row ----
  controlsScroll: {
    paddingBottom: spacing.xs,
  },
  controlsContent: {
    paddingHorizontal: spacing.md,
  },
  controlBtn: {
    backgroundColor: appColors.background,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: appColors.border,
    marginRight: spacing.sm,
  },
  controlText: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontFamily: 'monospace',
  },
  // ---- Info row (usage + session/cwd) ----
  infoScroll: {
    paddingTop: spacing.xs,
  },
  infoContent: {
    paddingHorizontal: spacing.md,
  },
  infoChip: {
    marginRight: spacing.md,
  },
  infoText: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontFamily: 'monospace',
    marginRight: spacing.md,
  },
  infoTextClickable: {
    color: appColors.agentCodex,
    fontWeight: '700',
  },
  usageHigh: {
    color: appColors.error,
  },
  // ---- Image preview modal ----
  imagePreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePreviewFull: {
    width: '90%',
    height: '80%',
  },
  // ---- Resume session modal ----
  resumeEmpty: {
    padding: spacing.xl,
    alignItems: 'center' as const,
  },
  resumeEmptyText: {
    fontSize: fontSize.sm,
    color: appColors.textSecondary,
    marginTop: spacing.sm,
  },
  resumeItem: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  resumeItemHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
  },
  resumeItemId: {
    fontSize: fontSize.xs,
    color: appColors.accent,
    fontFamily: 'monospace',
    fontWeight: '600' as const,
  },
  resumeItemBranch: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontFamily: 'monospace',
  },
  resumeItemTime: {
    fontSize: fontSize.xs,
    color: appColors.textMuted,
    marginLeft: 'auto' as const,
  },
  resumeItemTitle: {
    fontSize: fontSize.sm,
    color: appColors.text,
    fontWeight: '600' as const,
    marginTop: spacing.xs,
  },
  resumeItemPreview: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    marginTop: spacing.xs,
  },
  // ---- Model picker modal ----
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  modalContent: {
    backgroundColor: appColors.surface,
    borderRadius: 12,
    maxHeight: '60%',
    paddingVertical: spacing.md,
  },
  modalTitle: {
    fontSize: fontSize.lg,
    color: appColors.text,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  modelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  modelItemActive: {
    backgroundColor: appColors.accentDim,
  },
  modelLabelWrap: {
    flex: 1,
    paddingRight: spacing.md,
  },
  modelItemText: {
    fontSize: fontSize.sm,
    color: appColors.text,
    fontWeight: '600',
  },
  modelItemTextActive: {
    color: appColors.accent,
    fontWeight: '600',
  },
  modelValueText: {
    marginTop: 2,
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontFamily: 'monospace',
  },
  modelDescriptionText: {
    marginTop: 2,
    fontSize: fontSize.xs,
    color: appColors.textMuted,
  },
  modelCheck: {
    fontSize: fontSize.md,
    color: appColors.accent,
    fontWeight: '700',
  },
})
