/**
 * i18next initialization. Resources are bundled, so init is synchronous and no
 * Suspense boundary is needed. The initial language comes from the persisted
 * preference (read straight from MMKV to avoid a circular import on the store).
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { createMMKV } from 'react-native-mmkv'

import en from './locales/en.json'
import zhHant from './locales/zh-Hant.json'
import zhHans from './locales/zh-Hans.json'
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_ID,
  LANGUAGE_STORAGE_KEY,
  resolvePreference,
  type LanguagePreference,
} from './config'

export const resources = {
  en: { translation: en },
  'zh-Hant': { translation: zhHant },
  'zh-Hans': { translation: zhHans },
} as const

function readInitialLanguage() {
  try {
    const stored = createMMKV({ id: LANGUAGE_STORAGE_ID }).getString(LANGUAGE_STORAGE_KEY)
    return resolvePreference((stored as LanguagePreference) || 'system')
  } catch {
    return DEFAULT_LANGUAGE
  }
}

i18n.use(initReactI18next).init({
  resources,
  lng: readInitialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  defaultNS: 'translation',
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
})

export default i18n
