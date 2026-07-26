/**
 * Host connection secrets must not survive into the app.
 *
 * A remote-type profile is the host's alias for a *different* machine, and the
 * host's entry for it carries that machine's credentials. BAT Desktop ships
 * `remoteToken` in the clear on both `profile:list` and the `profile:changed`
 * broadcast (src-tauri/src/commands/profile.rs — `hydrate_remote_tokens` refills
 * it on every index read), so these payloads arrive holding a credential this
 * device was never granted and has no use for.
 *
 * `normalizeProfiles` copies named fields rather than spreading, which is the
 * only thing keeping that out of the store and out of MMKV. These tests exist so
 * that turning it into a spread — the obvious "just add a field" refactor —
 * fails loudly instead of leaking silently.
 */

import { useWorkspaceStore } from '../src/stores/workspace-store'

const TOKEN = 'super-secret-host-token-do-not-copy'
const FINGERPRINT = 'AA:BB:CC:DD:EE:FF'

const HOST_PAYLOAD = {
  profiles: [
    { id: 'default', name: 'Default', type: 'local', createdAt: 1, updatedAt: 2 },
    {
      id: 'tail-hyper',
      name: 'tail hyper',
      type: 'remote',
      // Everything below is the host's business, not ours.
      remoteToken: TOKEN,
      remoteHost: 'hyper.tail-scale.ts.net',
      remotePort: 9876,
      remoteFingerprint: FINGERPRINT,
      remoteProfileId: 'default',
      createdAt: 3,
      updatedAt: 4,
    },
  ],
  activeProfileIds: ['default'],
}

beforeEach(() => {
  useWorkspaceStore.setState({ profiles: [], activeProfileIds: [], activeLocalProfileId: null })
})

describe('profile payloads from the host', () => {
  it('keeps no trace of a remote credential anywhere in the store', () => {
    useWorkspaceStore.getState().handleProfileChanged(HOST_PAYLOAD)

    // Serialising the whole slice rather than checking known keys: a spread
    // would reintroduce fields this test cannot know the names of.
    const stored = JSON.stringify(useWorkspaceStore.getState().profiles)
    expect(stored).not.toContain(TOKEN)
    expect(stored).not.toContain(FINGERPRINT)
    expect(stored).not.toContain('hyper.tail-scale.ts.net')
  })

  it('carries exactly the fields the UI needs and nothing else', () => {
    useWorkspaceStore.getState().handleProfileChanged(HOST_PAYLOAD)

    const remote = useWorkspaceStore.getState().profiles.find(p => p.id === 'tail-hyper')
    expect(Object.keys(remote!).sort()).toEqual(['createdAt', 'id', 'name', 'type', 'updatedAt'])
  })

  it('still shows the remote profile so the user knows it exists', () => {
    useWorkspaceStore.getState().handleProfileChanged(HOST_PAYLOAD)

    // Dropping the secrets must not mean dropping the entry: knowing which
    // profiles the host has is the part the client is entitled to.
    const remote = useWorkspaceStore.getState().profiles.find(p => p.id === 'tail-hyper')
    expect(remote).toMatchObject({ name: 'tail hyper', type: 'remote' })
  })

  it('never makes a remote profile the active one', () => {
    useWorkspaceStore.getState().handleProfileChanged({
      ...HOST_PAYLOAD,
      // The host can have a remote profile active in one of its own windows.
      activeProfileIds: ['tail-hyper'],
    })

    // Adopting it would point every workspace call at a profile whose contents
    // live on another machine, which this client cannot reach — the host does
    // the dialling, and it does not do it on our behalf.
    expect(useWorkspaceStore.getState().activeLocalProfileId).not.toBe('tail-hyper')
  })
})
