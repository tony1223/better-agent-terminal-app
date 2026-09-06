import { useClaudeStore } from './claude-store'
import { useUsageStore } from './usage-store'
import { useSessionPreviewStore } from './session-preview-store'
import { switchRecentsScope } from './recents-store'

export function activateProfileScope(key: string) {
  if (useClaudeStore.getState().scopeKey === key) return
  useClaudeStore.getState().switchScope(key)
  useUsageStore.getState().clear()
  useSessionPreviewStore.setState({ previews: {} })
  switchRecentsScope(key)
}
