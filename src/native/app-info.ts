import { NativeModules } from 'react-native'

import { APP_VERSION } from '@/app-version'

interface AppInfoConstants {
  /** CFBundleShortVersionString / versionName — the release tag CI built from. */
  version?: string
  /** CFBundleVersion / versionCode — CI's run number. */
  build?: string
}

const native: AppInfoConstants = NativeModules.AppInfo ?? {}

/**
 * What the installed binary says it is.
 *
 * Preferred over APP_VERSION because it cannot drift: APP_VERSION is written
 * into the bundle by the two release workflows, so it reads 'dev' for anything
 * they didn't build, carries no build number, and would silently ship 'dev' if
 * that step were ever skipped. The bundle's own CFBundleShortVersionString /
 * versionName is stamped by the same tag and needs nothing kept in sync.
 *
 * APP_VERSION stays as the fallback for contexts with no native module —
 * tests, and a JS reload against a binary built before this existed.
 */
export const appVersion: string = native.version || APP_VERSION
export const appBuild: string = native.build || ''

/** e.g. "1.0.37 (44)", or just "1.0.37" if the build number is unavailable. */
export const appVersionLabel: string = appBuild
  ? `${appVersion} (${appBuild})`
  : appVersion
