/**
 * AskUserDialog - Modal for claude:ask-user events
 */

import React, { useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
} from 'react-native'
import { useClaudeStore } from '@/stores/claude-store'
import { useConnectionStore } from '@/stores/connection-store'
import { appColors, spacing, fontSize } from '@/theme/colors'

export function AskUserDialog() {
  const pending = useClaudeStore(s => s.pendingAskUser)
  const clearAskUser = useClaudeStore(s => s.clearAskUser)
  const channels = useConnectionStore(s => s.channels)

  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [customText, setCustomText] = useState('')

  if (!pending) return null

  const handleSelect = (question: string, value: string) => {
    setAnswers(prev => ({ ...prev, [question]: value }))
  }

  const handleSubmit = async () => {
    if (!channels) return

    // Use custom text as the answer for first question if provided
    const finalAnswers = { ...answers }
    if (customText.trim() && pending.questions.length > 0) {
      const firstQ = pending.questions[0].question
      if (!finalAnswers[firstQ]) {
        finalAnswers[firstQ] = customText.trim()
      }
    }

    await channels.claude.resolveAskUser(pending.sessionId, pending.toolUseId, finalAnswers)
    clearAskUser()
    setAnswers({})
    setCustomText('')
  }

  return (
    <View style={styles.overlay}>
      <View style={styles.dialog}>
        <Text style={styles.title}>Claude is asking</Text>

        <ScrollView style={styles.scroll}>
          {pending.questions.map((q, qi) => (
            <View key={qi} style={styles.questionBlock}>
              <Text style={styles.header}>{q.header}</Text>
              <Text style={styles.question}>{q.question}</Text>

              {q.options.map((opt, oi) => {
                const selected = answers[q.question] === opt.label
                return (
                  <TouchableOpacity
                    key={oi}
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => handleSelect(q.question, opt.label)}
                  >
                    <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                      {opt.label}
                    </Text>
                    <Text style={styles.optionDesc}>{opt.description}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          ))}

          <TextInput
            style={styles.customInput}
            value={customText}
            onChangeText={setCustomText}
            placeholder="Or type a custom response..."
            placeholderTextColor={appColors.textMuted}
            multiline
          />
        </ScrollView>

        <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
          <Text style={styles.submitText}>Submit</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
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
  submitButton: {
    backgroundColor: appColors.accent,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  submitText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: fontSize.lg,
  },
})
