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
  KeyboardAvoidingView,
  Platform,
  FlatList,
  ScrollView,
  Modal,
  Image,
  Alert,
} from 'react-native'
import { launchImageLibrary } from 'react-native-image-picker'
import { useClaudeStore, EMPTY_SESSION } from '@/stores/claude-store'
import { useConnectionStore } from '@/stores/connection-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { appColors, spacing, fontSize } from '@/theme/colors'
import { MessageBubble } from '@/components/claude/MessageBubble'
import { ToolCallCard } from '@/components/claude/ToolCallCard'
import { StreamingText } from '@/components/claude/StreamingText'
import { SessionContextBar } from '@/components/session/SessionContextBar'
import { dlog } from '@/utils/debug-log'
import type { ClaudeMessage, ClaudeToolCall } from '@/types'
import { isToolCall } from '@/types'
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
const INITIAL_LOAD_UI_TIMEOUT_MS = 6_000

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
  const sessionId = route.params?.sessionId as string
  const channels = useConnectionStore(s => s.channels)
  const session = useClaudeStore(s => s.sessions[sessionId] || EMPTY_SESSION)
  const promptSuggestions = useClaudeStore(s => s.promptSuggestions)
  const terminal = useWorkspaceStore(s => s.terminals.find(t => t.id === sessionId))
  const workspace = useWorkspaceStore(s => {
    const term = s.terminals.find(t => t.id === sessionId)
    return term ? s.workspaces.find(w => w.id === term.workspaceId) : undefined
  })
  const loadStatus = useWorkspaceStore(s => s.loadStatus)

  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(true)
  const [permissionMode, setPermissionMode] = useState('bypassPermissions')
  const [effortLevel, setEffortLevel] = useState('high')
  const [codexSandboxMode, setCodexSandboxMode] = useState<typeof CODEX_SANDBOX_MODES[number]>('workspace-write')
  const [codexApprovalPolicy, setCodexApprovalPolicy] = useState<typeof CODEX_APPROVAL_POLICIES[number]>('on-request')
  const [showFab, setShowFab] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showEffortPicker, setShowEffortPicker] = useState(false)
  const [showSandboxPicker, setShowSandboxPicker] = useState(false)
  const [showApprovalPicker, setShowApprovalPicker] = useState(false)
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([])
  const [attachedImages, setAttachedImages] = useState<{ uri: string; dataUrl: string }[]>([])
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null)
  const [historyLoadingInBackground, setHistoryLoadingInBackground] = useState(false)
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
  const agentPreset = terminal?.agentPreset
  const isCodexAgent = agentPreset === 'codex-agent'
  const isOpenAIAgent = agentPreset === 'openai-agent'
  const effortOptions = isCodexAgent ? CODEX_EFFORT_LEVELS : CLAUDE_EFFORT_LEVELS
  const terminalCwd = terminal?.cwd
  const terminalSdkSessionId = terminal?.sdkSessionId
  const terminalModel = terminal?.model
  const terminalSandboxMode = terminal?.agentParams?.sandboxMode
  const terminalApprovalPolicy = terminal?.agentParams?.approvalPolicy

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => navigation.navigate('TerminalList')}
        >
          <Text style={styles.headerButtonText}>Sessions</Text>
        </TouchableOpacity>
      ),
      headerTitle: () => (
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {workspace?.alias || workspace?.name || 'Workspace'}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {terminal?.alias || terminal?.title || 'Claude'}
          </Text>
        </View>
      ),
    })
  }, [navigation, terminal?.alias, terminal?.title, workspace?.alias, workspace?.name])

  useEffect(() => {
    if ((loadStatus === 'ok' || loadStatus === 'empty') && !terminal) {
      useClaudeStore.getState().setActiveSession(null)
      navigation.goBack()
    }
  }, [loadStatus, navigation, terminal])

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
      const buildLoadKey = (sdkSessionIdToResume: string | null) => JSON.stringify({
        sessionId,
        cwd: terminalCwd,
        sdkSessionId: sdkSessionIdToResume,
        model: terminalModel ?? null,
        agentPreset: agentPreset ?? null,
        codexSandboxMode: codexSandboxMode ?? null,
        codexApprovalPolicy: codexApprovalPolicy ?? null,
      })
      const resumeWithSdkSessionId = async (sdkSessionIdToResume: string) => {
        const loadKey = buildLoadKey(sdkSessionIdToResume)
        if (loadedSessionKeyRef.current === loadKey || inFlightSessionKeyRef.current === loadKey) {
          dlog('CLAUDE_SCREEN', `skip duplicate history load sdkSessionId=${sdkSessionIdToResume}`)
          return
        }
        dlog('CLAUDE_SCREEN', `resuming session sdkSessionId=${sdkSessionIdToResume}`)
        inFlightSessionKeyRef.current = loadKey
        try {
          await timedLoadStep(
            `resumeSession sessionId=${sessionId} sdkSessionId=${sdkSessionIdToResume}`,
            () => channels.claude.resumeSession(
              sessionId,
              sdkSessionIdToResume,
              terminalCwd,
              terminalModel,
              {
                agentPreset,
                codexSandboxMode,
                codexApprovalPolicy,
              },
            ),
          )
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
            await resumeWithSdkSessionId(terminalSdkSessionId)
          } else {
            dlog('CLAUDE_SCREEN', 'no sdkSessionId, trying getSessionMeta')
            let metaLoaded = false
            try {
              const meta = await timedLoadStep(
                `getSessionMeta sessionId=${sessionId}`,
                () => channels.claude.getSessionMeta(sessionId),
              )
              if (meta) {
                metaLoaded = true
                useClaudeStore.getState().handleStatus(sessionId, meta)
                if (meta.sdkSessionId) {
                  await resumeWithSdkSessionId(meta.sdkSessionId)
                  return
                }
              }
            } catch (e) {
              dlog('CLAUDE_SCREEN', `getSessionMeta error: ${e}`)
            }
            if (!metaLoaded) {
              dlog('CLAUDE_SCREEN', 'no existing backend session, starting fresh')
              const loadKey = buildLoadKey(null)
              if (loadedSessionKeyRef.current !== loadKey && inFlightSessionKeyRef.current !== loadKey) {
                inFlightSessionKeyRef.current = loadKey
                try {
                  await timedLoadStep(
                    `startSession sessionId=${sessionId}`,
                    () => channels.claude.startSession(sessionId, {
                      cwd: terminalCwd,
                      permissionMode,
                      model: terminalModel,
                      effort: effortLevel,
                      agentPreset,
                      codexSandboxMode,
                      codexApprovalPolicy,
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
          dlog('CLAUDE_SCREEN', `loadHistory error: ${e}`)
        } finally {
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
    terminalSandboxMode,
    terminalApprovalPolicy,
    agentPreset,
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
    if (!(effortOptions as readonly string[]).includes(effortLevel)) {
      setEffortLevel('high')
    }
  }, [effortLevel, effortOptions])

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
      useClaudeStore.getState().handleSessionReset(sessionId)
      channels.claude.resetSession(sessionId)
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
          : await channels.claude.listSessions(terminal.cwd)
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

    const contentParts: string[] = []
    if (text) contentParts.push(text)
    if (images.length > 0) contentParts.push(`[${images.length} image${images.length > 1 ? 's' : ''} attached]`)

    useClaudeStore.getState().handleMessage(sessionId, {
      id: `user-local-${Date.now()}`,
      sessionId,
      role: 'user',
      content: contentParts.join('\n'),
      timestamp: Date.now(),
    })

    channels.claude.sendMessage(sessionId, text, images.length > 0 ? images : undefined)
      .catch(e => {
        console.warn('[Claude] sendMessage error:', e)
      })
      .finally(() => {
        sendInFlightRef.current = false
      })
  }, [inputText, attachedImages, channels, sessionId, terminal?.cwd, isOpenAIAgent])

  const handleStop = useCallback(async () => {
    if (!channels) return
    await channels.claude.stopSession(sessionId)
  }, [channels, sessionId])

  const handlePermissionCycle = useCallback(async () => {
    if (!channels) return
    const idx = PERMISSION_MODES.indexOf(permissionMode as typeof PERMISSION_MODES[number])
    const next = PERMISSION_MODES[(idx + 1) % PERMISSION_MODES.length]
    setPermissionMode(next)
    await channels.claude.setPermissionMode(sessionId, next)
  }, [channels, sessionId, permissionMode])

  const handleEffortSelect = useCallback(async (effort: string) => {
    if (!channels) return
    setShowEffortPicker(false)
    setEffortLevel(effort)
    await channels.claude.setEffort(sessionId, effort)
  }, [channels, sessionId])

  const handleCodexSandboxSelect = useCallback(async (mode: typeof CODEX_SANDBOX_MODES[number]) => {
    if (!channels) return
    setShowSandboxPicker(false)
    setCodexSandboxMode(mode)
    await channels.claude.setCodexSandboxMode(sessionId, mode)
  }, [channels, sessionId])

  const handleCodexApprovalSelect = useCallback(async (policy: typeof CODEX_APPROVAL_POLICIES[number]) => {
    if (!channels) return
    setShowApprovalPicker(false)
    setCodexApprovalPolicy(policy)
    await channels.claude.setCodexApprovalPolicy(sessionId, policy)
  }, [channels, sessionId])

  const handleCompact = useCallback(async () => {
    if (!channels) return
    await channels.openai.compactNow(sessionId)
  }, [channels, sessionId])

  const handleModelPress = useCallback(async () => {
    if (!channels) return
    try {
      const models = await channels.claude.getSupportedModels(sessionId)
      setAvailableModels(normalizeModelOptions(models))
      setShowModelPicker(true)
    } catch (e) {
      console.warn('[Claude] getSupportedModels error:', e)
      Alert.alert('Unable to load models', String(e))
    }
  }, [channels, sessionId])

  const handleModelSelect = useCallback(async (model: ModelOption) => {
    if (!channels) return
    setShowModelPicker(false)
    try {
      await channels.claude.setModel(sessionId, model.value)
    } catch (e) {
      console.warn('[Claude] setModel error:', e)
      Alert.alert('Unable to switch model', String(e))
    }
  }, [channels, sessionId])

  const handleFork = useCallback(async () => {
    if (!channels) return
    try {
      await channels.claude.forkSession(sessionId)
    } catch (e) {
      console.warn('[Claude] fork error:', e)
    }
  }, [channels, sessionId])

  const handleResumeSelect = useCallback(async (sdkSessionId: string) => {
    if (!channels || !terminal) return
    setShowResumeList(false)
    setResumeSessions([])
    // Clear UI immediately
    useClaudeStore.getState().handleSessionReset(sessionId)
    // Resume the selected session
    await channels.claude.resumeSession(sessionId, sdkSessionId, terminal.cwd, terminal.model, {
      agentPreset,
      permissionMode,
      effort: effortLevel,
      codexSandboxMode,
      codexApprovalPolicy,
    })
    // Persist new sdkSessionId
    const wsStore = useWorkspaceStore.getState()
    const terminals = wsStore.terminals.map(t =>
      t.id === sessionId ? { ...t, sdkSessionId } : t
    )
    useWorkspaceStore.setState({ terminals })
  }, [channels, sessionId, terminal, agentPreset, permissionMode, effortLevel, codexSandboxMode, codexApprovalPolicy])

  const handleUpload = useCallback(() => {
    if (attachedImages.length >= MAX_IMAGES) {
      Alert.alert('Limit reached', `Maximum ${MAX_IMAGES} images allowed.`)
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
      Alert.alert('Rebuild required', 'Image picker needs a native rebuild. Run: npx react-native run-android')
    }
  }, [attachedImages.length])

  const removeImage = useCallback((index: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  const renderItem = useCallback(({ item }: { item: ClaudeMessage | ClaudeToolCall }) => {
    if (isToolCall(item)) {
      return <ToolCallCard tool={item} />
    }
    return <MessageBubble message={item} />
  }, [])

  const showStreaming = session.isStreaming && (session.streamingText || session.streamingThinking)

  // Inverted FlatList: data is reversed so newest = index 0 = visible at bottom
  const invertedItems = useMemo(() => [...session.messages].reverse(), [session.messages])

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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <SessionContextBar
        workspaceId={terminal?.workspaceId}
        detail={terminal?.cwd}
      />
      {/* Message list */}
      <View style={styles.listContainer}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={appColors.accent} />
            <Text style={styles.loadingText}>Loading session...</Text>
          </View>
        ) : invertedItems.length === 0 && !showStreaming ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>{'\u2726'}</Text>
            <Text style={styles.emptyText}>
              {historyLoadingInBackground ? 'Syncing history...' : 'No messages yet'}
            </Text>
            <Text style={styles.emptySubtext}>
              {historyLoadingInBackground
                ? 'History is still loading in the background.'
                : 'Send a message to start a conversation with Claude'}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={invertedItems}
            renderItem={renderItem}
            inverted
            contentContainerStyle={styles.listContent}
            keyExtractor={(item) => item.id}
            onScroll={handleScroll}
            scrollEventThrottle={200}
            ListHeaderComponent={showStreaming ? (
              <StreamingText text={session.streamingText} thinking={session.streamingThinking} />
            ) : null}
          />
        )}
        {/* Scroll to bottom FAB */}
        {showFab && invertedItems.length > 0 && (
          <TouchableOpacity style={styles.scrollFab} onPress={handleScrollToBottomPress} activeOpacity={0.8}>
            <Text style={styles.scrollFabText}>{'\u2193'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Input area */}
      <View style={styles.inputArea}>
        {/* Prompt suggestions */}
        {promptSuggestions.length > 0 && !session.isStreaming && (
          <View style={styles.suggestions}>
            {promptSuggestions.map((s, i) => (
              <TouchableOpacity
                key={i}
                style={styles.suggestionChip}
                onPress={() => setInputText(s)}
              >
                <Text style={styles.suggestionLabel}>suggest</Text>
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
            placeholder="Message Claude..."
            placeholderTextColor={appColors.textMuted}
            multiline
            maxLength={100000}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!inputText.trim() && attachedImages.length === 0) && styles.sendDisabled]}
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
          <TouchableOpacity style={styles.controlBtn} onPress={handlePermissionCycle}>
            <Text style={[styles.controlText, { color: modeColor }]}>
              {PERMISSION_LABELS[permissionMode] || permissionMode}
            </Text>
          </TouchableOpacity>

          {session.meta?.model && (
            <TouchableOpacity style={styles.controlBtn} onPress={handleModelPress}>
              <Text style={styles.controlText}>{'</>'} {session.meta.model}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.controlBtn} onPress={() => setShowEffortPicker(true)}>
            <Text style={styles.controlText}>
              {isCodexAgent ? `thinking:${effortLevel}` : `effort:${effortLevel}`}
            </Text>
          </TouchableOpacity>

          {isCodexAgent && (
            <>
              <TouchableOpacity style={styles.controlBtn} onPress={() => setShowSandboxPicker(true)}>
                <Text style={styles.controlText}>sandbox:{codexSandboxMode}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.controlBtn} onPress={() => setShowApprovalPicker(true)}>
                <Text style={styles.controlText}>approval:{codexApprovalPolicy}</Text>
              </TouchableOpacity>
            </>
          )}

          {isOpenAIAgent && (
            <TouchableOpacity style={styles.controlBtn} onPress={handleCompact}>
              <Text style={styles.controlText}>compact</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.controlBtn} onPress={handleFork}>
            <Text style={styles.controlText}>{'\u2442'} Fork</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlBtn} onPress={handleUpload}>
            <Text style={styles.controlText}>
              {attachedImages.length > 0 ? `\uD83D\uDCCE ${attachedImages.length}/${MAX_IMAGES}` : '\uD83D\uDCCE'}
            </Text>
          </TouchableOpacity>

          {session.isStreaming && (
            <TouchableOpacity style={[styles.controlBtn, { backgroundColor: appColors.error, borderColor: appColors.error }]} onPress={handleStop}>
              <Text style={[styles.controlText, { color: '#fff', fontWeight: '700' }]}>Stop</Text>
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
            <Text style={styles.infoText}>sid:{sdkSessionShort}</Text>
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
            <Text style={styles.modalTitle}>Select Model</Text>
            <FlatList
              data={availableModels}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modelItem, item.value === session.meta?.model && styles.modelItemActive]}
                  onPress={() => handleModelSelect(item)}
                >
                  <View style={styles.modelLabelWrap}>
                    <Text style={[styles.modelItemText, item.value === session.meta?.model && styles.modelItemTextActive]}>
                      {item.displayName}
                    </Text>
                    <Text style={styles.modelValueText}>{item.value}</Text>
                    {item.description ? (
                      <Text style={styles.modelDescriptionText}>{item.description}</Text>
                    ) : null}
                  </View>
                  {item.value === session.meta?.model && (
                    <Text style={styles.modelCheck}>{'\u2713'}</Text>
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
            <Text style={styles.modalTitle}>{isCodexAgent ? 'Select Thinking' : 'Select Effort'}</Text>
            <FlatList
              data={[...effortOptions]}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modelItem, item === effortLevel && styles.modelItemActive]}
                  onPress={() => handleEffortSelect(item)}
                >
                  <Text style={[styles.modelItemText, item === effortLevel && styles.modelItemTextActive]}>
                    {isCodexAgent ? `thinking: ${item}` : `effort: ${item}`}
                  </Text>
                  {item === effortLevel && (
                    <Text style={styles.modelCheck}>{'\u2713'}</Text>
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
            <Text style={styles.modalTitle}>Select Sandbox</Text>
            <FlatList
              data={[...CODEX_SANDBOX_MODES]}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modelItem, item === codexSandboxMode && styles.modelItemActive]}
                  onPress={() => handleCodexSandboxSelect(item)}
                >
                  <Text style={[styles.modelItemText, item === codexSandboxMode && styles.modelItemTextActive]}>
                    sandbox: {item}
                  </Text>
                  {item === codexSandboxMode && (
                    <Text style={styles.modelCheck}>{'\u2713'}</Text>
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
            <Text style={styles.modalTitle}>Select Approval</Text>
            <FlatList
              data={[...CODEX_APPROVAL_POLICIES]}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modelItem, item === codexApprovalPolicy && styles.modelItemActive]}
                  onPress={() => handleCodexApprovalSelect(item)}
                >
                  <Text style={[styles.modelItemText, item === codexApprovalPolicy && styles.modelItemTextActive]}>
                    approval: {item}
                  </Text>
                  {item === codexApprovalPolicy && (
                    <Text style={styles.modelCheck}>{'\u2713'}</Text>
                  )}
                </TouchableOpacity>
              )}
            />
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
            <Text style={styles.modalTitle}>Resume Session</Text>
            {resumeLoading ? (
              <View style={styles.resumeEmpty}>
                <ActivityIndicator size="small" color={appColors.accent} />
                <Text style={styles.resumeEmptyText}>Loading sessions...</Text>
              </View>
            ) : resumeSessions.length === 0 ? (
              <View style={styles.resumeEmpty}>
                <Text style={styles.resumeEmptyText}>No sessions found</Text>
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
    </KeyboardAvoidingView>
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
  infoText: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontFamily: 'monospace',
    marginRight: spacing.md,
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
