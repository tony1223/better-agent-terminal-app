import { useEffect, useMemo, useState } from 'react'
import { useConnectionStore } from '@/stores/connection-store'
import { IMAGE_EXTS } from '@/utils/file-preview'
import { getFileExt } from '@/utils/path-tokenizer'

export function useFilePreview(path: string, inlineImage?: string, imageOnly = false) {
  const channels = useConnectionStore(s => s.channels)
  const [attempt, setAttempt] = useState(0)
  const request = useMemo(() => ({ path, channels, inlineImage, imageOnly, attempt }), [path, channels, inlineImage, imageOnly, attempt])
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
        if (!channels) return
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
  }, [request, path, channels, inlineImage, imageOnly])
  // Never show a previous path/profile's bytes while a new request is loading.
  const current = result?.request === request ? result : null
  return {
    content: current?.content, imageUrl: current?.imageUrl, error: current?.error,
    disconnected: !channels && !inlineImage,
    loading: !current && (!!channels || !!inlineImage),
    retry: () => setAttempt(value => value + 1),
    channels,
  }
}
