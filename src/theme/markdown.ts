/**
 * Dark-theme overrides for react-native-markdown-display's built-in styles.
 *
 * The library merges our styles into its own defaults key by key, and those
 * defaults assume a white page: blockquotes and code blocks sit on #F5F5F5,
 * rules and table borders are black. Any key a sheet forgets to override keeps
 * the light value, which is how a quoted line rendered as a blank white box
 * (our light text on the library's near-white fill). Every markdown sheet in
 * the app spreads this base first, so no element can fall back to it.
 */

import { appColors, spacing } from './colors'

export const darkMarkdownBase = {
  blockquote: {
    backgroundColor: appColors.surfaceHover,
    borderColor: appColors.borderStrong,
    borderLeftWidth: 4,
    marginLeft: 0,
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    color: appColors.text,
  },
  code_block: {
    backgroundColor: appColors.background,
    borderColor: appColors.border,
    color: appColors.text,
  },
  fence: {
    backgroundColor: appColors.background,
    borderColor: appColors.border,
    color: appColors.text,
  },
  hr: {
    backgroundColor: appColors.borderStrong,
  },
  table: {
    borderColor: appColors.borderStrong,
  },
  th: {
    borderColor: appColors.borderStrong,
  },
  tr: {
    borderColor: appColors.borderStrong,
  },
  td: {
    borderColor: appColors.borderStrong,
  },
} as const
