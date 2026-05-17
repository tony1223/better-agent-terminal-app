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
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.map(normalizeHost) : []
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

function normalizeFingerprint(fingerprint?: string): string | undefined {
  if (!fingerprint) return undefined
  const normalized = fingerprint.toUpperCase().replace(/[^A-F0-9]/g, '')
  return normalized || undefined
}

function normalizeHost<T extends Partial<SavedHost>>(host: T): T {
  const next = { ...host }
  const hasFingerprint = Object.prototype.hasOwnProperty.call(host, 'fingerprint')
  const hasUseTLS = Object.prototype.hasOwnProperty.call(host, 'useTLS')

  if (hasFingerprint) {
    next.fingerprint = normalizeFingerprint(host.fingerprint)
  }

  if (hasFingerprint || hasUseTLS) {
    next.useTLS = host.useTLS || !!next.fingerprint
  }

  return next
}

interface HostState {
  hosts: SavedHost[]
  activeHostId: string | null

  loadFromStorage: () => void
  addHost: (host: Omit<SavedHost, 'id'>, token: string) => Promise<void>
  /**
   * Insert or update a host keyed by address+port.
   * Returns the id of the affected host. Updates fingerprint, token, and other
   * metadata in place when an existing entry matches.
   */
  upsertHost: (host: Omit<SavedHost, 'id'>, token: string) => Promise<{ id: string; created: boolean }>
  /** Update the fingerprint for an existing host. */
  updateFingerprint: (id: string, fingerprint: string) => Promise<void>
  removeHost: (id: string) => Promise<void>
  updateHost: (id: string, updates: Partial<Omit<SavedHost, 'id'>>, token?: string) => Promise<void>
  getToken: (id: string) => Promise<string | null>
  getFingerprint: (id: string) => string | null
  findByAddress: (address: string, port: number) => SavedHost | null
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
    const normalizedHostData = normalizeHost(hostData)
    const existing = get().hosts.find(host =>
      host.address === normalizedHostData.address &&
      host.port === normalizedHostData.port
    )

    if (existing) {
      const hosts = get().hosts.map(host =>
        host.id === existing.id ? { ...host, ...normalizedHostData } : host
      )
      saveHosts(hosts)
      await Keychain.setGenericPassword(existing.id, token, { service: `${TOKEN_SERVICE}-${existing.id}` })
      set({ hosts })
      return
    }

    const id = generateId()
    const host: SavedHost = { ...normalizedHostData, id }
    const hosts = [...get().hosts, host]
    saveHosts(hosts)

    await Keychain.setGenericPassword(id, token, { service: `${TOKEN_SERVICE}-${id}` })

    set({ hosts })
  },

  upsertHost: async (hostData, token) => {
    const normalizedHostData = normalizeHost(hostData)
    const existing = get().hosts.find(
      h => h.address === normalizedHostData.address && h.port === normalizedHostData.port,
    )
    if (existing) {
      const merged: SavedHost = { ...existing, ...normalizedHostData, id: existing.id, name: existing.name }
      const hosts = get().hosts.map(h => (h.id === existing.id ? merged : h))
      saveHosts(hosts)
      await Keychain.setGenericPassword(existing.id, token, { service: `${TOKEN_SERVICE}-${existing.id}` })
      set({ hosts })
      return { id: existing.id, created: false }
    }

    const id = generateId()
    const host: SavedHost = { ...normalizedHostData, id }
    const hosts = [...get().hosts, host]
    saveHosts(hosts)
    await Keychain.setGenericPassword(id, token, { service: `${TOKEN_SERVICE}-${id}` })
    set({ hosts })
    return { id, created: true }
  },

  updateFingerprint: async (id, fingerprint) => {
    const normalized = normalizeFingerprint(fingerprint)
    const hosts = get().hosts.map(h =>
      h.id === id ? { ...h, fingerprint: normalized, useTLS: true } : h
    )
    saveHosts(hosts)
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
    const normalizedUpdates = normalizeHost(updates)
    const hosts = get().hosts.map(h =>
      h.id === id ? { ...h, ...normalizedUpdates } : h
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

  findByAddress: (address, port) => {
    return get().hosts.find(h => h.address === address && h.port === port) ?? null
  },

  setActiveHost: (id) => {
    set({ activeHostId: id })
  },
}))
