/**
 * ClaudeScreen - Claude agent chat interface
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
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

const EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const
const MAX_IMAGES = 5

export function ClaudeScreen({ route }: Props) {
  const sessionId = route.params?.sessionId as string
  const channels = useConnectionStore(s => s.channels)
  const session = useClaudeStore(s => s.sessions[sessionId] || EMPTY_SESSION)
  const promptSuggestions = useClaudeStore(s => s.promptSuggestions)
  const terminal = useWorkspaceStore(s => s.terminals.find(t => t.id === sessionId))

  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(true)
  const [permissionMode, setPermissionMode] = useState('bypassPermissions')
  const [effortLevel, setEffortLevel] = useState('high')
  const [showFab, setShowFab] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [attachedImages, setAttachedImages] = useState<{ uri: string; dataUrl: string }[]>([])
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null)
  const [usage, setUsage] = useState<{ fiveHour: number | null; sevenDay: number | null; fiveHourReset: string | null; sevenDayReset: string | null } | null>(null)
  const isAtBottomRef = useRef(true)
  const listRef = useRef<any>(null)

  // Init session in store and load history
  useEffect(() => {
    dlog('CLAUDE_SCREEN', `mount sessionId=${sessionId}`)
    dlog('CLAUDE_SCREEN', `terminal found: ${!!terminal}, sdkSessionId=${terminal?.sdkSessionId}, agentPreset=${terminal?.agentPreset}`)

    useClaudeStore.getState().initSession(sessionId)
    useClaudeStore.getState().setActiveSession(sessionId)

    if (channels && terminal) {
      const loadHistory = async () => {
        try {
          if (terminal.sdkSessionId) {
            dlog('CLAUDE_SCREEN', `resuming session sdkSessionId=${terminal.sdkSessionId}`)
            await channels.claude.resumeSession(
              sessionId,
              terminal.sdkSessionId,
              terminal.cwd,
              terminal.model
            )
          } else {
            dlog('CLAUDE_SCREEN', 'no sdkSessionId, trying getSessionMeta')
            try {
              const meta = await channels.claude.getSessionMeta(sessionId)
              if (meta) useClaudeStore.getState().handleStatus(sessionId, meta)
            } catch (e) {
              dlog('CLAUDE_SCREEN', `getSessionMeta error: ${e}`)
            }
          }
        } catch (e) {
          dlog('CLAUDE_SCREEN', `loadHistory error: ${e}`)
        }
        setLoading(false)
      }
      loadHistory()
    } else {
      setLoading(false)
    }
  }, [sessionId])

  // Fetch usage on mount and poll every 60s
  useEffect(() => {
    if (!channels) return
    const fetchUsage = () => {
      channels.claude.getUsage().then((u: any) => {
        if (u && !u.rateLimited) setUsage(u)
      }).catch(() => {})
    }
    fetchUsage()
    const timer = setInterval(fetchUsage, 60_000)
    return () => clearInterval(timer)
  }, [channels])

  // Sync permission mode from meta
  useEffect(() => {
    if (session.meta?.permissionMode) {
      setPermissionMode(session.meta.permissionMode)
    }
  }, [session.meta?.permissionMode])

  const handleSend = useCallback(() => {
    if ((!inputText.trim() && attachedImages.length === 0) || !channels) return
    const text = inputText.trim()

    // Handle /new command
    if (text === '/new') {
      setInputText('')
      useClaudeStore.getState().handleSessionReset(sessionId)
      channels.claude.resetSession(sessionId).catch(e => {
        console.warn('[Claude] resetSession error:', e)
      })
      return
    }

    const images = attachedImages.map(img => img.dataUrl)
    setInputText('')
    setAttachedImages([])

    const contentParts: string[] = []
    if (images.length > 0) contentParts.push(`[${images.length} image(s)]`)
    if (text) contentParts.push(text)

    useClaudeStore.getState().handleMessage(sessionId, {
      id: `user-${Date.now()}`,
      sessionId,
      role: 'user',
      content: contentParts.join(' '),
      timestamp: Date.now(),
    })

    channels.claude.sendMessage(sessionId, text, images.length > 0 ? images : undefined).catch(e => {
      console.warn('[Claude] sendMessage error:', e)
    })
  }, [inputText, attachedImages, channels, sessionId])

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

  const handleEffortCycle = useCallback(async () => {
    if (!channels) return
    const idx = EFFORT_LEVELS.indexOf(effortLevel as typeof EFFORT_LEVELS[number])
    const next = EFFORT_LEVELS[(idx + 1) % EFFORT_LEVELS.length]
    setEffortLevel(next)
    await channels.claude.setEffort(sessionId, next)
  }, [channels, sessionId, effortLevel])

  const handleModelPress = useCallback(async () => {
    if (!channels) return
    try {
      const models = await channels.claude.getSupportedModels(sessionId)
      setAvailableModels(models || [])
      setShowModelPicker(true)
    } catch (e) {
      console.warn('[Claude] getSupportedModels error:', e)
    }
  }, [channels, sessionId])

  const handleModelSelect = useCallback(async (model: string) => {
    if (!channels) return
    setShowModelPicker(false)
    await channels.claude.setModel(sessionId, model)
  }, [channels, sessionId])

  const handleFork = useCallback(async () => {
    if (!channels) return
    try {
      await channels.claude.forkSession(sessionId)
    } catch (e) {
      console.warn('[Claude] fork error:', e)
    }
  }, [channels, sessionId])

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
            <Text style={styles.emptyText}>No messages yet</Text>
            <Text style={styles.emptySubtext}>Send a message to start a conversation with Claude</Text>
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

          <TouchableOpacity style={styles.controlBtn} onPress={handleEffortCycle}>
            <Text style={styles.controlText}>{effortLevel}</Text>
          </TouchableOpacity>

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
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modelItem, item === session.meta?.model && styles.modelItemActive]}
                  onPress={() => handleModelSelect(item)}
                >
                  <Text style={[styles.modelItemText, item === session.meta?.model && styles.modelItemTextActive]}>
                    {item}
                  </Text>
                  {item === session.meta?.model && (
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
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appColors.background,
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
  modelItemText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: appColors.text,
    fontFamily: 'monospace',
  },
  modelItemTextActive: {
    color: appColors.accent,
    fontWeight: '600',
  },
  modelCheck: {
    fontSize: fontSize.md,
    color: appColors.accent,
    fontWeight: '700',
  },
})
