import { create } from 'zustand'
import type { SetStateAction } from 'react'
import { useCallback } from 'react'

interface Draft {
  text: string
  images: Array<{ uri: string; dataUrl: string }>
}
const EMPTY: Draft = { text: '', images: [] }
export const useSessionDraftsStore = create<{
  drafts: Record<string, Draft>
  update: (key: string, changes: Partial<Draft>) => void
}>(set => ({
  drafts: {},
  update: (key, changes) =>
    set(state => {
      const draft = { ...(state.drafts[key] ?? EMPTY), ...changes }
      const drafts = { ...state.drafts }
      if (!draft.text && !draft.images.length) delete drafts[key]
      else drafts[key] = draft
      return { drafts }
    }),
}))
/** In-memory only: unsent messages/images never get written into profile catalogs. */
export function useSessionDraft(scope: string, sessionId: string) {
  const key = JSON.stringify([scope, sessionId])
  const draft = useSessionDraftsStore(state => state.drafts[key] ?? EMPTY)
  const update = useSessionDraftsStore(state => state.update)
  const setInputText = useCallback(
    (value: SetStateAction<string>) =>
      update(key, {
        text:
          typeof value === 'function'
            ? value(useSessionDraftsStore.getState().drafts[key]?.text ?? '')
            : value,
      }),
    [key, update],
  )
  const setAttachedImages = useCallback(
    (value: SetStateAction<Draft['images']>) =>
      update(key, {
        images:
          typeof value === 'function'
            ? value(useSessionDraftsStore.getState().drafts[key]?.images ?? [])
            : value,
      }),
    [key, update],
  )
  return {
    inputText: draft.text,
    attachedImages: draft.images,
    setInputText,
    setAttachedImages,
  }
}
