/**
 * Language preference store - persists the chosen UI language to MMKV and keeps
 * i18next in sync. "system" follows the device locale.
 */

import { create } from 'zustand'
import { createMMKV } from 'react-native-mmkv'

import i18n from '@/i18n'
import {
  LANGUAGE_STORAGE_ID,
  LANGUAGE_STORAGE_KEY,
  resolvePreference,
  type LanguagePreference,
} from '@/i18n/config'

const storage = createMMKV({ id: LANGUAGE_STORAGE_ID })

function loadPreference(): LanguagePreference {
  const raw = storage.getString(LANGUAGE_STORAGE_KEY)
  if (raw === 'system' || raw === 'en' || raw === 'zh-Hant' || raw === 'zh-Hans') {
    return raw
  }
  return 'system'
}

interface LanguageState {
  preference: LanguagePreference
  setPreference: (preference: LanguagePreference) => void
}

export const useLanguageStore = create<LanguageState>((set) => ({
  preference: loadPreference(),

  setPreference: (preference) => {
    storage.set(LANGUAGE_STORAGE_KEY, preference)
    i18n.changeLanguage(resolvePreference(preference))
    set({ preference })
  },
}))
