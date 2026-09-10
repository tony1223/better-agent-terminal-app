import { NativeModules } from 'react-native'

interface FileExporterModule {
  saveBase64(dataBase64: string, fileName: string): Promise<string | null>
}

export function base64FromDataUrl(dataUrl: string): string {
  const marker = ';base64,'
  const markerIndex = dataUrl.indexOf(marker)
  if (!dataUrl.startsWith('data:') || markerIndex < 5) {
    throw new Error('Host returned an invalid file payload')
  }

  const data = dataUrl.slice(markerIndex + marker.length)
  return data
}

export async function saveBase64File(fileName: string, dataUrl: string): Promise<boolean> {
  const exporter = NativeModules.FileExporter as FileExporterModule | undefined
  if (!exporter?.saveBase64) {
    throw new Error('File export is unavailable in this app build')
  }

  const savedUri = await exporter.saveBase64(base64FromDataUrl(dataUrl), fileName)
  return savedUri !== null
}
