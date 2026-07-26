/**
 * Move an existing Google Play release between tracks.
 *
 * Not a rebuild: this promotes the exact AAB that was already uploaded and
 * tested. Re-running the release workflow would produce a fresh versionCode
 * (it comes from github.run_number), so the artifact reaching production would
 * not be the one anybody tried.
 *
 * Also the way to advance a staged rollout — read from `production`, write to
 * `production`, with a higher percentage.
 *
 * Env:
 *   PLAY_SERVICE_ACCOUNT_JSON  service account key (the raw JSON)
 *   PACKAGE_NAME               e.g. com.tonyq.betteragentterminal
 *   FROM_TRACK / TO_TRACK      e.g. beta -> production
 *   VERSION_CODE               optional; defaults to the newest in FROM_TRACK
 *   ROLLOUT_PERCENT            1-100; <100 stages the rollout
 *   DRY_RUN                    'true' to abandon the edit instead of committing
 */

import { JWT } from 'google-auth-library'

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

const packageName = required('PACKAGE_NAME')
const fromTrack = required('FROM_TRACK')
const toTrack = required('TO_TRACK')
const versionCode = (process.env.VERSION_CODE || '').trim()
const rollout = Number(process.env.ROLLOUT_PERCENT || '100')
const dryRun = process.env.DRY_RUN === 'true'

if (!Number.isFinite(rollout) || rollout <= 0 || rollout > 100) {
  throw new Error(`ROLLOUT_PERCENT must be 1-100, got ${process.env.ROLLOUT_PERCENT}`)
}

const credentials = JSON.parse(required('PLAY_SERVICE_ACCOUNT_JSON'))
const auth = new JWT({
  email: credentials.client_email,
  key: credentials.private_key,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
})

const { token } = await auth.getAccessToken()

async function call(method, path, body) {
  const res = await fetch(`${API}/${packageName}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}\n${text}`)
  return text ? JSON.parse(text) : null
}

const { id: editId } = await call('POST', '/edits')
console.log(`edit ${editId} opened`)

// Any failure past this point leaves an edit sitting on the app; abandoning it
// keeps the next run from tripping over a half-applied change.
async function abandon() {
  try {
    await call('DELETE', `/edits/${editId}`)
    console.log(`edit ${editId} abandoned`)
  } catch (err) {
    console.warn(`could not abandon edit ${editId}: ${err.message}`)
  }
}

try {
  const source = await call('GET', `/edits/${editId}/tracks/${fromTrack}`)
  const releases = source.releases ?? []
  if (releases.length === 0) throw new Error(`No releases on track '${fromTrack}'`)

  const highest = release => Math.max(...(release.versionCodes ?? []).map(Number))
  const release = versionCode
    ? releases.find(r => (r.versionCodes ?? []).map(String).includes(versionCode))
    : releases.reduce((best, r) => (highest(r) > highest(best) ? r : best))

  if (!release) {
    const seen = releases.flatMap(r => r.versionCodes ?? []).join(', ')
    throw new Error(`versionCode ${versionCode} is not on track '${fromTrack}' (found: ${seen})`)
  }

  // Play rejects userFraction on a completed release, and requires it on an
  // in-progress one — the percentage decides which shape is legal.
  const staged = rollout < 100
  const promoted = {
    name: release.name,
    versionCodes: (release.versionCodes ?? []).map(String),
    ...(release.releaseNotes ? { releaseNotes: release.releaseNotes } : {}),
    status: staged ? 'inProgress' : 'completed',
    ...(staged ? { userFraction: rollout / 100 } : {}),
  }

  console.log(`promoting ${fromTrack} -> ${toTrack}`)
  console.log(`  name          ${promoted.name ?? '(unnamed)'}`)
  console.log(`  versionCodes  ${promoted.versionCodes.join(', ')}`)
  console.log(`  status        ${promoted.status}${staged ? ` (${rollout}% of users)` : ''}`)
  console.log(`  releaseNotes  ${promoted.releaseNotes ? `${promoted.releaseNotes.length} locale(s)` : 'none carried over'}`)

  await call('PUT', `/edits/${editId}/tracks/${toTrack}`, {
    track: toTrack,
    releases: [promoted],
  })

  if (dryRun) {
    console.log('DRY RUN: nothing committed.')
    await abandon()
    process.exit(0)
  }

  await call('POST', `/edits/${editId}:commit`)
  console.log(`committed. ${promoted.versionCodes.join(', ')} is now on '${toTrack}'.`)
} catch (err) {
  await abandon()
  throw err
}
