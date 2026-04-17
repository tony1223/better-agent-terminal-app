/**
 * Host Manager Store - manages saved BAT server hosts
 * Host metadata (including fingerprint) → MMKV (fast, non-sensitive)
 * Tokens → Keychain (secure)
 */

import { create } from 'zustand'
import { createMMKV } from 'react-native-mmkv'
import * as Keychain from 'react-native-keychain'
import type { SavedHost } from '@/types'

const storage = createMMKV({ id: 'bat-mobile-hosts' })

const HOSTS_KEY = 'saved-hosts'
const TOKEN_SERVICE = 'bat-mobile-token'

function loadHosts(): SavedHost[] {
  try {
    const raw = storage.getString(HOSTS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHosts(hosts: SavedHost[]) {
  storage.set(HOSTS_KEY, JSON.stringify(hosts))
}

function generateId(): string {
  return `host-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`
}

interface HostState {
  hosts: SavedHost[]
  activeHostId: string | null

  loadFromStorage: () => void
  addHost: (host: Omit<SavedHost, 'id'>, token: string) => Promise<void>
  removeHost: (id: string) => Promise<void>
  updateHost: (id: string, updates: Partial<Omit<SavedHost, 'id'>>, token?: string) => Promise<void>
  getToken: (id: string) => Promise<string | null>
  getFingerprint: (id: string) => string | null
  setActiveHost: (id: string) => void
}

export const useHostStore = create<HostState>((set, get) => ({
  hosts: [],
  activeHostId: null,

  loadFromStorage: () => {
    const hosts = loadHosts()
    set({ hosts })
  },

  addHost: async (hostData, token) => {
    const id = generateId()
    const host: SavedHost = { ...hostData, id }
    const hosts = [...get().hosts, host]
    saveHosts(hosts)

    await Keychain.setGenericPassword(id, token, { service: `${TOKEN_SERVICE}-${id}` })

    set({ hosts })
  },

  removeHost: async (id) => {
    const hosts = get().hosts.filter(h => h.id !== id)
    saveHosts(hosts)

    await Keychain.resetGenericPassword({ service: `${TOKEN_SERVICE}-${id}` })

    const activeHostId = get().activeHostId === id ? null : get().activeHostId
    set({ hosts, activeHostId })
  },

  updateHost: async (id, updates, token) => {
    const hosts = get().hosts.map(h =>
      h.id === id ? { ...h, ...updates } : h
    )
    saveHosts(hosts)

    if (token) {
      await Keychain.setGenericPassword(id, token, { service: `${TOKEN_SERVICE}-${id}` })
    }

    set({ hosts })
  },

  getToken: async (id) => {
    try {
      const result = await Keychain.getGenericPassword({ service: `${TOKEN_SERVICE}-${id}` })
      return result ? result.password : null
    } catch {
      return null
    }
  },

  getFingerprint: (id) => {
    const host = get().hosts.find(h => h.id === id)
    return host?.fingerprint ?? null
  },

  setActiveHost: (id) => {
    set({ activeHostId: id })
  },
}))
