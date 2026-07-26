/**
 * AskUserSummary - what the agent asked and what was picked.
 *
 * An AskUserQuestion steers the rest of the turn exactly like a typed prompt,
 * so the timeline shows the exchange rather than the tool's raw JSON. Questions
 * and answers are always visible; the full option list with its descriptions is
 * behind the card's expand, since only the chosen one usually matters later.
 */

import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { appColors, spacing, fontSize } from '@/theme/colors'
import type { AskUserExchange } from '@/utils/ask-user-answers'

interface Props {
  exchange: AskUserExchange[]
  /** Show every option with its description, not just what was chosen. */
  showOptions: boolean
}

export function AskUserSummary({ exchange, showOptions }: Props) {
  const { t } = useTranslation()

  return (
    <View style={styles.wrap}>
      {exchange.map((item, index) => {
        // An "Other" answer is free text, so it matches no option label.
        const custom = item.chosen.filter(
          pick => !item.options.some(option => option.label === pick),
        )
        return (
          <View key={`${item.header}-${index}`} style={styles.block}>
            <Text style={styles.header}>{item.header}</Text>
            <Text style={styles.question} selectable>{item.question}</Text>

            {item.answer === null ? (
              <Text style={styles.pending}>{t('askUserSummary.pending')}</Text>
            ) : item.chosen.length === 0 ? (
              <Text style={styles.pending}>{t('askUserSummary.noAnswer')}</Text>
            ) : null}

            {showOptions
              ? item.options.map(option => {
                const picked = item.chosen.includes(option.label)
                return (
                  <View key={option.label} style={[styles.option, picked && styles.optionPicked]}>
                    <Text style={[styles.optionLabel, picked && styles.optionLabelPicked]}>
                      {picked ? '✓ ' : '  '}{option.label}
                    </Text>
                    {option.description ? (
                      <Text style={styles.optionDesc} selectable>{option.description}</Text>
                    ) : null}
                  </View>
                )
              })
              : item.chosen
                .filter(pick => item.options.some(option => option.label === pick))
                .map(pick => (
                  <View key={pick} style={[styles.option, styles.optionPicked]}>
                    <Text style={[styles.optionLabel, styles.optionLabelPicked]}>
                      {'✓ '}{pick}
                    </Text>
                  </View>
                ))}

            {custom.map(answer => (
              <View key={answer} style={[styles.option, styles.optionPicked]}>
                <Text style={styles.customLabel}>{t('askUserSummary.custom')}</Text>
                <Text style={[styles.optionLabel, styles.optionLabelPicked]} selectable>
                  {'✓ '}{answer}
                </Text>
              </View>
            ))}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
    marginLeft: 16, // aligns with the text after the timeline dot
  },
  block: {
    marginBottom: spacing.sm,
    paddingLeft: spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: appColors.border,
  },
  header: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  question: {
    fontSize: fontSize.sm,
    color: appColors.text,
    marginTop: 2,
    marginBottom: spacing.xs,
  },
  pending: {
    fontSize: fontSize.xs,
    color: appColors.textMuted,
    fontStyle: 'italic',
  },
  option: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 6,
    marginTop: 2,
  },
  optionPicked: {
    backgroundColor: appColors.accentDim,
  },
  optionLabel: {
    fontSize: fontSize.sm,
    color: appColors.textSecondary,
  },
  optionLabelPicked: {
    color: appColors.text,
    fontWeight: '600',
  },
  optionDesc: {
    fontSize: fontSize.xs,
    color: appColors.textMuted,
    marginTop: 2,
  },
  customLabel: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
})
