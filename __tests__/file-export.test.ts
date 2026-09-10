import { NativeModules } from 'react-native'
import { base64FromDataUrl, saveBase64File } from '@/utils/file-export'

describe('file export', () => {
  const originalExporter = NativeModules.FileExporter

  afterEach(() => {
    NativeModules.FileExporter = originalExporter
  })

  it('extracts the original base64 bytes from a data URL', () => {
    expect(base64FromDataUrl('data:application/octet-stream;base64,AAEC/w==')).toBe('AAEC/w==')
  })

  it('rejects malformed payloads and preserves zero-byte files', () => {
    expect(() => base64FromDataUrl('plain text')).toThrow('invalid file payload')
    expect(base64FromDataUrl('data:text/plain;base64,')).toBe('')
  })

  it('passes bytes and the original filename to the native save dialog', async () => {
    const saveBase64 = jest.fn().mockResolvedValue('content://downloads/example.txt')
    NativeModules.FileExporter = { saveBase64 }

    await expect(saveBase64File('example.txt', 'data:text/plain;base64,aGVsbG8=')).resolves.toBe(true)
    expect(saveBase64).toHaveBeenCalledWith('aGVsbG8=', 'example.txt')
  })

  it('reports cancellation without treating it as a failure', async () => {
    NativeModules.FileExporter = { saveBase64: jest.fn().mockResolvedValue(null) }
    await expect(saveBase64File('example.txt', 'data:text/plain;base64,aA==')).resolves.toBe(false)
  })
})
