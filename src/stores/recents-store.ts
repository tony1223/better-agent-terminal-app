/**
 * Which workspaces and sessions this phone actually opens.
 *
 * The host's app state has no notion of "recent" — it knows which workspace is
 * active and nothing about the order you reached for the others. On desktop
 * that's fine, everything is on screen at once. On a phone the whole list is a
 * scroll away, and the handful you keep returning to should be at the top.
 *
 * So recency is deliberately local and per-device: the workspaces you open on
 * your phone are not the ones you open at your desk, and syncing that through
 * `workspace:save` would both fight the desktop and put a write on the same
 * path that once clobbered workspace state.
 */

import { create } from 'zustand'
import { createMMKV } from 'react-native-mmkv'

const storage = createMMKV({ id: 'bat-recents' })
const STORAGE_KEY = 'recents-state-v1'

/**
 * Enough for the strip plus history to survive a few detours; past this the
 * tail is noise and we'd just be growing the payload we re-serialise on every
 * open.
 */
const MAX_TRACKED = 40

export interface RecentEntry {
  id: string
  /** Times opened, ever. Ranks the "frequent" half of "recent and frequent". */
  count: number
  /** Epoch ms of the most recent open. */
  lastOpenedAt: number
}

interface StoredState {
  workspaces: Record<string, RecentEntry>
  sessions: Record<string, RecentEntry>
}

interface RecentsState extends StoredState {
  touchWorkspace: (id: string) => void
  touchSession: (id: string) => void
  forgetWorkspace: (id: string) => void
  forgetSession: (id: string) => void
}

function normalizeEntries(value: unknown): Record<string, RecentEntry> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, RecentEntry> = {}
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const count = typeof record.count === 'number' && record.count > 0 ? record.count : 1
    const lastOpenedAt = typeof record.lastOpenedAt === 'number' ? record.lastOpenedAt : 0
    if (!id || !lastOpenedAt) continue
    out[id] = { id, count, lastOpenedAt }
  }
  return out
}

function loadFromStorage(): StoredState {
  try {
    const raw = storage.getString(STORAGE_KEY)
    if (!raw) return { workspaces: {}, sessions: {} }
    const parsed = JSON.parse(raw)
    return {
      workspaces: normalizeEntries(parsed?.workspaces),
      sessions: normalizeEntries(parsed?.sessions),
    }
  } catch {
    return { workspaces: {}, sessions: {} }
  }
}

function persist(state: StoredState) {
  storage.set(STORAGE_KEY, JSON.stringify(state))
}

/** Drop the coldest entries once the map outgrows MAX_TRACKED. */
function prune(entries: Record<string, RecentEntry>): Record<string, RecentEntry> {
  const ids = Object.keys(entries)
  if (ids.length <= MAX_TRACKED) return entries
  const keep = ids
    .map(id => entries[id])
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, MAX_TRACKED)
  return Object.fromEntries(keep.map(entry => [entry.id, entry]))
}

function touch(entries: Record<string, RecentEntry>, id: string): Record<string, RecentEntry> {
  const existing = entries[id]
  return prune({
    ...entries,
    [id]: {
      id,
      count: (existing?.count ?? 0) + 1,
      lastOpenedAt: Date.now(),
    },
  })
}

export const useRecentsStore = create<RecentsState>((set) => {
  const initial = loadFromStorage()
  return {
    workspaces: initial.workspaces,
    sessions: initial.sessions,

    touchWorkspace: (id) => set(state => {
      if (!id) return {}
      const workspaces = touch(state.workspaces, id)
      persist({ workspaces, sessions: state.sessions })
      return { workspaces }
    }),

    touchSession: (id) => set(state => {
      if (!id) return {}
      const sessions = touch(state.sessions, id)
      persist({ workspaces: state.workspaces, sessions })
      return { sessions }
    }),

    forgetWorkspace: (id) => set(state => {
      if (!state.workspaces[id]) return {}
      const workspaces = { ...state.workspaces }
      delete workspaces[id]
      persist({ workspaces, sessions: state.sessions })
      return { workspaces }
    }),

    forgetSession: (id) => set(state => {
      if (!state.sessions[id]) return {}
      const sessions = { ...state.sessions }
      delete sessions[id]
      persist({ workspaces: state.workspaces, sessions })
      return { sessions }
    }),
  }
})

/**
 * Rank by "would I want this at the top right now", which is neither pure
 * recency (the workspace you opened once by mistake this morning outranks the
 * one you live in) nor pure frequency (a project you finished last month stays
 * pinned forever).
 *
 * Each open is worth a point, halving every `HALF_LIFE_MS`, so a workspace
 * opened twice today beats one opened ten times a fortnight ago, and today's
 * single accidental open doesn't beat either.
 */
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000

export function recencyScore(entry: RecentEntry, now: number): number {
  const ageMs = Math.max(0, now - entry.lastOpenedAt)
  return entry.count * Math.pow(0.5, ageMs / HALF_LIFE_MS)
}

/**
 * Ids from `entries` that still exist in `validIds`, best-first.
 *
 * Filtering against live ids matters: a deleted workspace lingers in storage
 * (nothing tells us it's gone) and must not show up as a row that opens nothing.
 */
export function rankRecents(
  entries: Record<string, RecentEntry>,
  validIds: Iterable<string>,
  now: number,
  limit: number,
): string[] {
  const valid = validIds instanceof Set ? validIds : new Set(validIds)
  return Object.values(entries)
    .filter(entry => valid.has(entry.id))
    .sort((a, b) => recencyScore(b, now) - recencyScore(a, now) || b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, limit)
    .map(entry => entry.id)
}
