import { NativeModules } from 'react-native'

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
 * The settings screen used to hardcode "0.1.0", which had never been true of
 * any build shipped to a store. Both platforms already carry the real numbers:
 * CI stamps them from the release tag and the run number, so reading them back
 * needs no second source to keep in sync.
 *
 * The fallback is only reachable in a JS-only context (tests, or a reload
 * against a binary built before this module existed) — and it says so, rather
 * than inventing a version number.
 */
export const appVersion: string = native.version || 'dev'
export const appBuild: string = native.build || ''

/** e.g. "1.0.37 (44)", or just "1.0.37" if the build number is unavailable. */
export const appVersionLabel: string = appBuild
  ? `${appVersion} (${appBuild})`
  : appVersion
