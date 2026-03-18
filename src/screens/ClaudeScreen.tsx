/**
 * ClaudeScreen - Claude agent chat interface
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
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
} from 'react-native'
import { useClaudeStore } from '@/stores/claude-store'
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

export function ClaudeScreen({ route }: Props) {
  const sessionId = route.params?.sessionId as string
  const channels = useConnectionStore(s => s.channels)
  const session = useClaudeStore(s => s.getSession(sessionId))
  const promptSuggestions = useClaudeStore(s => s.promptSuggestions)
  const terminal = useWorkspaceStore(s => s.terminals.find(t => t.id === sessionId))

  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const listRef = useRef<any>(null)

  // Init session in store and load history
  useEffect(() => {
    dlog('CLAUDE_SCREEN', `mount sessionId=${sessionId}`)
    dlog('CLAUDE_SCREEN', `terminal found: ${!!terminal}, sdkSessionId=${terminal?.sdkSessionId}, agentPreset=${terminal?.agentPreset}`)

    useClaudeStore.getState().initSession(sessionId)
    useClaudeStore.getState().setActiveSession(sessionId)

    // Try to load history from server
    if (channels && terminal) {
      const loadHistory = async () => {
        try {
          if (terminal.sdkSessionId) {
            // Resume session to get history - this triggers claude:history event
            dlog('CLAUDE_SCREEN', `resuming session sdkSessionId=${terminal.sdkSessionId}`)
            await channels.claude.resumeSession(
              sessionId,
              terminal.sdkSessionId,
              terminal.cwd,
              terminal.model
            )
            dlog('CLAUDE_SCREEN', 'resumeSession succeeded')
          } else {
            // No existing session - try to get session meta
            dlog('CLAUDE_SCREEN', 'no sdkSessionId, trying getSessionMeta')
            try {
              const meta = await channels.claude.getSessionMeta(sessionId)
              dlog('CLAUDE_SCREEN', `getSessionMeta result: ${JSON.stringify(meta)}`)
              if (meta) {
                useClaudeStore.getState().handleStatus(sessionId, meta)
              }
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
      dlog('CLAUDE_SCREEN', `no channels (${!!channels}) or no terminal (${!!terminal})`)
      setLoading(false)
    }
  }, [sessionId])

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || !channels || sending) return
    const text = inputText.trim()
    setInputText('')
    setSending(true)

    try {
      await channels.claude.sendMessage(sessionId, text)
    } catch (e) {
      console.warn('[Claude] sendMessage error:', e)
    }

    setSending(false)
  }, [inputText, channels, sessionId, sending])

  const handleStop = useCallback(async () => {
    if (!channels) return
    await channels.claude.stopSession(sessionId)
  }, [channels, sessionId])

  const renderItem = useCallback(({ item }: { item: ClaudeMessage | ClaudeToolCall }) => {
    if (isToolCall(item)) {
      return <ToolCallCard tool={item} />
    }
    return <MessageBubble message={item} />
  }, [])

  // Build display items: messages + streaming text
  const items = session.messages
  const showStreaming = session.isStreaming && session.streamingText

  // Auto-scroll to bottom when new messages arrive or streaming
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true })
    }, 100)
  }, [])

  useEffect(() => {
    if (items.length > 0 || showStreaming) {
      scrollToBottom()
    }
  }, [items.length, showStreaming, scrollToBottom])

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Meta bar */}
      {session.meta && (
        <View style={styles.metaBar}>
          <Text style={styles.metaText}>
            {session.meta.model || 'Claude'} | {session.meta.numTurns} turns | ${session.meta.totalCost?.toFixed(4) ?? '0'}
          </Text>
          {session.isStreaming && (
            <TouchableOpacity onPress={handleStop} style={styles.stopButton}>
              <Text style={styles.stopText}>Stop</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Message list */}
      <View style={styles.listContainer}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={appColors.accent} />
            <Text style={styles.loadingText}>Loading session...</Text>
          </View>
        ) : items.length === 0 && !showStreaming ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>{'\u2726'}</Text>
            <Text style={styles.emptyText}>No messages yet</Text>
            <Text style={styles.emptySubtext}>Send a message to start a conversation with Claude</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={items}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            keyExtractor={(item) => item.id}
            onContentSizeChange={scrollToBottom}
            ListFooterComponent={showStreaming ? (
              <StreamingText text={session.streamingText} thinking={session.streamingThinking} />
            ) : null}
          />
        )}
      </View>

      {/* Prompt suggestions */}
      {promptSuggestions.length > 0 && !session.isStreaming && (
        <View style={styles.suggestions}>
          {promptSuggestions.map((s, i) => (
            <TouchableOpacity
              key={i}
              style={styles.suggestionChip}
              onPress={() => setInputText(s)}
            >
              <Text style={styles.suggestionText} numberOfLines={1}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Input bar */}
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
          style={[styles.sendButton, (!inputText.trim() || sending) && styles.sendDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.sendText}>{'\u2191'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appColors.background,
  },
  metaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  metaText: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontFamily: 'monospace',
  },
  stopButton: {
    backgroundColor: appColors.error,
    borderRadius: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  stopText: {
    fontSize: fontSize.xs,
    color: '#fff',
    fontWeight: '700',
  },
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
  suggestions: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  suggestionChip: {
    backgroundColor: appColors.surface,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  suggestionText: {
    fontSize: fontSize.sm,
    color: appColors.text,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: appColors.border,
    backgroundColor: appColors.surface,
  },
  input: {
    flex: 1,
    backgroundColor: appColors.background,
    borderRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: appColors.text,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: appColors.border,
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
})
