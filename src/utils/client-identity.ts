import { Platform } from 'react-native'
import { createMMKV } from 'react-native-mmkv'
import { APP_VERSION } from '@/app-version'

const storage = createMMKV({ id: 'bat-client-identity' })
const DEVICE_ID_KEY = 'deviceId'

export interface RemoteClientIdentity {
  appName: string
  appVersion: string
  deviceId: string
  deviceName: string
  label: string
  model?: string
  osVersion: string
  platform: string
}

function randomHex(length: number): string {
  let value = ''
  while (value.length < length) {
    value += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
  }
  return value.slice(0, length)
}

function getDeviceId(): string {
  const existing = storage.getString(DEVICE_ID_KEY)
  if (existing) return existing

  const id = `bat-mobile-${Date.now().toString(36)}-${randomHex(16)}`
  storage.set(DEVICE_ID_KEY, id)
  return id
}

function getDeviceName(): string {
  if (Platform.OS === 'ios') {
    return Platform.isPad ? 'iPad' : 'iPhone'
  }
  if (Platform.OS === 'android') {
    const constants = Platform.constants as typeof Platform.constants & { Model?: string }
    return constants.Model || 'Android device'
  }
  return `${Platform.OS} device`
}

function getModel(): string | undefined {
  if (Platform.OS === 'android') {
    const constants = Platform.constants as typeof Platform.constants & { Model?: string }
    return constants.Model
  }
  if (Platform.OS === 'ios') {
    return Platform.constants.interfaceIdiom || undefined
  }
  return undefined
}

export function getRemoteClientIdentity(): RemoteClientIdentity {
  const deviceId = getDeviceId()
  const shortId = deviceId.slice(-4).toUpperCase()
  const deviceName = getDeviceName()

  return {
    appName: 'Better Agent Terminal',
    appVersion: APP_VERSION,
    deviceId,
    deviceName,
    label: `BAT Mobile ${deviceName} (${shortId})`,
    model: getModel(),
    osVersion: String(Platform.Version),
    platform: Platform.OS,
  }
}
