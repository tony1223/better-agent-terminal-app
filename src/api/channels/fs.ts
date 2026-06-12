/**
 * File System Channel Proxy
 */

import type { WebSocketClient } from '../websocket-client'

// One raw MiB per chunk, matching the desktop remote client. The host caps a
// decoded chunk at 4 MiB and the whole file at 64 MiB. 1398104 base64 chars
// decode to exactly 1 MiB and the length is a multiple of 4, so every slice
// is independently decodable.
const UPLOAD_BASE64_CHUNK_CHARS = 1398104
const UPLOAD_MAX_TOTAL_BYTES = 64 * 1024 * 1024

function base64DecodedBytes(base64: string): number {
  let padding = 0
  if (base64.endsWith('==')) padding = 2
  else if (base64.endsWith('=')) padding = 1
  return Math.floor(base64.length / 4) * 3 - padding
}

export function createFsChannel(ws: WebSocketClient) {
  const uploadTmpBegin = (name: string, totalBytes: number) =>
    ws.invokeParams<{ uploadId: string }>('fs:upload-tmp-begin', { name, totalBytes }, [name, totalBytes])
  const uploadTmpChunk = (uploadId: string, dataBase64: string) =>
    ws.invokeParams<{ received: number }>('fs:upload-tmp-chunk', { uploadId, dataBase64 }, [uploadId, dataBase64])
  const uploadTmpEnd = (uploadId: string) =>
    ws.invokeParams<{ path: string }>('fs:upload-tmp-end', { uploadId }, [uploadId])
  const uploadTmpAbort = (uploadId: string) =>
    ws.invokeParams<boolean>('fs:upload-tmp-abort', { uploadId }, [uploadId])

  return {
    readdir: (dirPath: string) =>
      ws.invoke('fs:readdir', dirPath),
    readFile: (filePath: string) =>
      ws.invoke<{ content?: string; error?: string; size?: number }>('fs:readFile', filePath),
    search: (dirPath: string, query: string) =>
      ws.invoke('fs:search', dirPath, query),
    watch: (dirPath: string) =>
      ws.invoke('fs:watch', dirPath),
    unwatch: (dirPath: string) =>
      ws.invoke('fs:unwatch', dirPath),
    home: () =>
      ws.invoke<string>('fs:home'),
    listDirs: (dirPath: string) =>
      ws.invoke('fs:list-dirs', dirPath),
    mkdir: (dirPath: string) =>
      ws.invoke('fs:mkdir', dirPath),
    quickLocations: () =>
      ws.invoke('fs:quick-locations'),
    readImageAsDataUrl: (filePath: string) =>
      ws.invoke<string>('image:read-as-data-url', filePath),

    uploadTmpBegin,
    uploadTmpChunk,
    uploadTmpEnd,
    uploadTmpAbort,

    /**
     * Stream base64-encoded bytes into the host's tmp dir
     * (<temp>/bat-remote-uploads/) and resolve with the host-side path, which
     * can then be referenced in an agent conversation. Aborts the partial
     * upload on failure so the host GC has nothing to clean up.
     */
    uploadToHostTmp: async (name: string, base64Data: string): Promise<string> => {
      const totalBytes = base64DecodedBytes(base64Data)
      if (totalBytes <= 0) throw new Error('upload: empty payload')
      if (totalBytes > UPLOAD_MAX_TOTAL_BYTES) {
        throw new Error(`upload: file too large (${totalBytes} bytes, limit ${UPLOAD_MAX_TOTAL_BYTES} bytes)`)
      }
      const begin = await uploadTmpBegin(name, totalBytes)
      const uploadId = begin?.uploadId
      if (!uploadId) throw new Error('upload: host did not return uploadId')
      try {
        for (let offset = 0; offset < base64Data.length; offset += UPLOAD_BASE64_CHUNK_CHARS) {
          await uploadTmpChunk(uploadId, base64Data.slice(offset, offset + UPLOAD_BASE64_CHUNK_CHARS))
        }
        const end = await uploadTmpEnd(uploadId)
        if (!end?.path) throw new Error('upload: host did not return final path')
        return end.path
      } catch (e) {
        try { await uploadTmpAbort(uploadId) } catch { /* best effort */ }
        throw e
      }
    },

    onChanged: (cb: (event: { path: string; type: string }) => void) =>
      ws.on('fs:changed', cb as (...args: unknown[]) => void),
  }
}

export type FsChannel = ReturnType<typeof createFsChannel>
