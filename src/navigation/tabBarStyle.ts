import type { ViewStyle } from 'react-native'
import { appColors } from '@/theme/colors'

export const MAIN_TAB_BAR_STYLE: ViewStyle = {
  backgroundColor: appColors.surface,
  borderTopColor: appColors.border,
}

export const HIDDEN_TAB_BAR_STYLE: ViewStyle = {
  display: 'none',
}
