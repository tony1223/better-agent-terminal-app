import type { Channels } from '@/api/channels'
import { useConnectionStore } from '@/stores/connection-store'

/** Keep the destination across socket reconnections, but never across host/profile changes. */
export function hostAccountTarget(initialChannels: Channels) {
  const initial = useConnectionStore.getState()
  const matches = () => {
    const state = useConnectionStore.getState()
    return initial.channels === initialChannels && !!state.channels && state.client === initial.client &&
      state.host === initial.host && state.port === initial.port && state.selectedProfileId === initial.selectedProfileId &&
      state.profileViewKey === initial.profileViewKey
  }
  const channels = () => {
    const state = useConnectionStore.getState()
    return matches() && state.status === 'connected' &&
      (!state.client?.supportsProfileContext || state.profileStatus === 'ready') ? state.channels : null
  }
  return { matches, channels }
}
