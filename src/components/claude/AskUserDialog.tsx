/**
 * AskUserDialog - Modal for agent:ask-user events
 */

import React, { useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useClaudeStore } from '@/stores/claude-store'
import { useConnectionStore } from '@/stores/connection-store'
import { appColors, spacing, fontSize } from '@/theme/colors'

function textValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

export function AskUserDialog() {
  const { t } = useTranslation()
  const pending = useClaudeStore(s => s.pendingAskUser)
  const clearAskUser = useClaudeStore(s => s.clearAskUser)
  const channels = useConnectionStore(s => s.channels)

  // Single-select questions hold one label (string); multi-select questions
  // hold an array of selected labels. Keyed by question text.
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [customText, setCustomText] = useState('')

  if (!pending) return null

  const questions = Array.isArray(pending.questions) ? pending.questions : []

  const handleSelect = (question: string, value: string, multi: boolean) => {
    if (multi) {
      setAnswers(prev => {
        const cur = prev[question]
        const arr = Array.isArray(cur) ? cur : (typeof cur === 'string' && cur ? [cur] : [])
        const next = arr.includes(value) ? arr.filter(l => l !== value) : [...arr, value]
        return { ...prev, [question]: next }
      })
    } else {
      setAnswers(prev => ({ ...prev, [question]: value }))
    }
  }

  const isSelected = (question: string, label: string) => {
    const cur = answers[question]
    return Array.isArray(cur) ? cur.includes(label) : cur === label
  }

  const handleSubmit = async () => {
    if (!channels) return

    // The resolve protocol expects string values per question, so multi-select
    // arrays are joined into one comma-separated string.
    const finalAnswers: Record<string, string> = {}
    for (const [key, val] of Object.entries(answers)) {
      if (Array.isArray(val)) {
        if (val.length) finalAnswers[key] = val.join(', ')
      } else if (val) {
        finalAnswers[key] = val
      }
    }

    // Use custom text for the first question: append for multi-select, fill if empty otherwise.
    if (customText.trim() && questions.length > 0) {
      const firstQ = textValue(questions[0].question, 'question')
      const trimmed = customText.trim()
      const isMulti = questions[0].multiSelect === true
      if (isMulti) {
        finalAnswers[firstQ] = finalAnswers[firstQ] ? `${finalAnswers[firstQ]}, ${trimmed}` : trimmed
      } else if (!finalAnswers[firstQ]) {
        finalAnswers[firstQ] = trimmed
      }
    }

    await channels.claude.resolveAskUser(pending.sessionId, pending.toolUseId, finalAnswers)
    clearAskUser()
    setAnswers({})
    setCustomText('')
  }

  // Esc-key replacement: there is no protocol method to cancel a pending
  // question, so interrupting it means aborting the waiting turn.
  const handleInterrupt = async () => {
    const sessionId = pending.sessionId
    clearAskUser()
    setAnswers({})
    setCustomText('')
    if (channels) {
      await channels.claude.abortSession(sessionId)
    }
  }

  return (
    <View style={styles.overlay}>
      <KeyboardAvoidingView
        style={styles.avoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View style={styles.dialog}>
        <Text style={styles.title}>{t('askUserDialog.title')}</Text>

        <ScrollView style={styles.scroll}>
          {questions.map((q, qi) => {
            const question = textValue(q.question, `question-${qi}`)
            const header = textValue(q.header, t('askUserDialog.questionFallback'))
            const options = Array.isArray(q.options) ? q.options : []

            return (
              <View key={qi} style={styles.questionBlock}>
                <Text style={styles.header}>{header}</Text>
                <Text style={styles.question}>{question}</Text>
                {q.multiSelect === true && (
                  <Text style={styles.multiHint}>{t('askUserDialog.multiSelectHint')}</Text>
                )}

                {options.map((opt, oi) => {
                  const label = textValue(opt.label, t('askUserDialog.optionFallback', { n: oi + 1 }))
                  const description = textValue(opt.description)
                  const selected = isSelected(question, label)
                  return (
                    <TouchableOpacity
                      key={oi}
                      style={[styles.option, selected && styles.optionSelected]}
                      onPress={() => handleSelect(question, label, q.multiSelect === true)}
                    >
                      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                        {label}
                      </Text>
                      {!!description && (
                        <Text style={styles.optionDesc}>{description}</Text>
                      )}
                    </TouchableOpacity>
                  )
                })}
              </View>
            )
          })}

          <TextInput
            style={styles.customInput}
            value={customText}
            onChangeText={setCustomText}
            placeholder={t('askUserDialog.customPlaceholder')}
            placeholderTextColor={appColors.textMuted}
            multiline
          />
        </ScrollView>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.interruptButton} onPress={handleInterrupt}>
            <Text style={styles.interruptText}>{t('askUserDialog.interrupt')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
            <Text style={styles.submitText}>{t('askUserDialog.submit')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    zIndex: 1000,
  },
  avoider: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialog: {
    backgroundColor: appColors.surface,
    borderRadius: 16,
    padding: spacing.xl,
    width: '90%',
    maxHeight: '80%',
  },
  title: {
    fontSize: fontSize.xl,
    color: appColors.info,
    fontWeight: '700',
    marginBottom: spacing.lg,
  },
  scroll: {
    maxHeight: 400,
  },
  questionBlock: {
    marginBottom: spacing.lg,
  },
  header: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  question: {
    fontSize: fontSize.md,
    color: appColors.text,
    marginBottom: spacing.md,
  },
  multiHint: {
    fontSize: fontSize.xs,
    color: appColors.accent,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  option: {
    backgroundColor: appColors.background,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  optionSelected: {
    borderColor: appColors.accent,
    backgroundColor: appColors.accentDim,
  },
  optionLabel: {
    fontSize: fontSize.md,
    color: appColors.text,
    fontWeight: '600',
  },
  optionLabelSelected: {
    color: appColors.accent,
  },
  optionDesc: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    marginTop: 2,
  },
  customInput: {
    backgroundColor: appColors.background,
    borderRadius: 10,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: appColors.text,
    borderWidth: 1,
    borderColor: appColors.border,
    minHeight: 60,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    marginTop: spacing.lg,
  },
  interruptButton: {
    flex: 1,
    backgroundColor: appColors.errorDim,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  interruptText: {
    color: appColors.error,
    fontWeight: '700',
    fontSize: fontSize.lg,
  },
  submitButton: {
    flex: 1,
    backgroundColor: appColors.accent,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  submitText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: fontSize.lg,
  },
})
