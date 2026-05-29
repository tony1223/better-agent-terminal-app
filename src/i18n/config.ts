/**
 * i18n shared config: supported languages, device-locale detection, and the
 * MMKV key used to persist the user's choice. Kept dependency-free (no i18next,
 * no store) so both the i18n init module and the language store can import it.
 */

import { NativeModules, Platform } from 'react-native'

export type SupportedLanguage = 'en' | 'zh-Hant' | 'zh-Hans'
export type LanguagePreference = 'system' | SupportedLanguage

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['en', 'zh-Hant', 'zh-Hans']
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en'

/** Display names shown in the picker, each written in its own script. */
export const LANGUAGE_DISPLAY_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  'zh-Hant': '繁體中文',
  'zh-Hans': '简体中文',
}

export const LANGUAGE_STORAGE_ID = 'bat-mobile-settings'
export const LANGUAGE_STORAGE_KEY = 'language'

/** Best-effort device language tag (e.g. "zh-Hant-TW") without a native dep. */
function getDeviceLanguageTag(): string {
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings
      const tag = settings?.AppleLocale || settings?.AppleLanguages?.[0]
      if (tag) return String(tag)
    } else {
      const tag = NativeModules.I18nManager?.localeIdentifier
      if (tag) return String(tag)
    }
  } catch {
    // fall through to Intl
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return DEFAULT_LANGUAGE
  }
}

/** Map any BCP-47-ish tag onto one of the supported languages. */
export function resolveSupported(tag: string): SupportedLanguage {
  const lower = tag.toLowerCase().replace(/_/g, '-')
  if (lower.startsWith('zh')) {
    return /hant|tw|hk|mo/.test(lower) ? 'zh-Hant' : 'zh-Hans'
  }
  return 'en'
}

/** Resolve a stored preference (which may be "system") to a concrete language. */
export function resolvePreference(pref: LanguagePreference): SupportedLanguage {
  return pref === 'system' ? resolveSupported(getDeviceLanguageTag()) : pref
}
