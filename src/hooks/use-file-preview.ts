import { useEffect, useMemo, useState } from 'react'
import { useConnectionStore } from '@/stores/connection-store'
import { IMAGE_EXTS } from '@/utils/file-preview'
import { getFileExt } from '@/utils/path-tokenizer'

export function useFilePreview(path: string, inlineImage?: string, imageOnly = false) {
  const channels = useConnectionStore(s => s.channels)
  const profileStatus = useConnectionStore(s => s.profileStatus)
  const usesProfileContext = useConnectionStore(s => s.client?.supportsProfileContext === true)
  const retryConnection = useConnectionStore(s => s.retryNow)
  const profilePending = usesProfileContext && (profileStatus === 'loading' || profileStatus === 'idle')
  const profileUnavailable = usesProfileContext && profileStatus === 'unavailable'
  const [attempt, setAttempt] = useState(0)
  const request = useMemo(() => ({ path, channels, inlineImage, imageOnly, attempt, profileStatus }), [path, channels, inlineImage, imageOnly, attempt, profileStatus])
  const [result, setResult] = useState<{ request: typeof request; content?: string; imageUrl?: string; error?: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        if (inlineImage) {
          if (!inlineImage.startsWith('data:image/')) throw new Error('Invalid image data')
          if (!cancelled) setResult({ request, imageUrl: inlineImage })
          return
        }
        // During remote-profile open/reconnect, channels can be a fail-closed
        // placeholder. Wait for the target instead of reporting a file error
        // (or attempting to read a same-named path from the entry host).
        if (!channels || profilePending || profileUnavailable) return
        if (imageOnly || IMAGE_EXTS.has(getFileExt(path))) {
          const imageUrl = await channels.fs.readImageAsDataUrl(path)
          if (typeof imageUrl !== 'string' || !imageUrl.startsWith('data:image/')) throw new Error('Invalid image data')
          if (!cancelled) setResult({ request, imageUrl })
        } else {
          const data = await channels.fs.readFile(path)
          if (data?.error) throw new Error(data.error)
          const content = typeof data === 'string' ? data : data?.content
          if (typeof content !== 'string') throw new Error('Unexpected file response')
          if (!cancelled) setResult({ request, content })
        }
      } catch (error) {
        if (!cancelled) setResult({ request, error: String(error) })
      }
    }
    load()
    return () => { cancelled = true }
  }, [request, path, channels, inlineImage, imageOnly, profilePending, profileUnavailable])
  // Never show a previous path/profile's bytes while a new request is loading.
  const current = result?.request === request ? result : null
  return {
    content: current?.content, imageUrl: current?.imageUrl, error: current?.error,
    disconnected: !channels && !inlineImage,
    profileUnavailable: profileUnavailable && !inlineImage,
    loading: !current && (!!channels || !!inlineImage) && (!profileUnavailable || !!inlineImage),
    retry: () => {
      // A dead profile context cannot recover by repeating the same file RPC.
      // Reopen the selected context; never switch to another host/profile.
      if (profileUnavailable && !inlineImage) retryConnection()
      setAttempt(value => value + 1)
    },
    channels,
  }
}
