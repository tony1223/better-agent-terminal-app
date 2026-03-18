/**
 * Channel Proxies - unified export
 */

import type { WebSocketClient } from '../websocket-client'
import { createPtyChannel, type PtyChannel } from './pty'
import { createClaudeChannel, type ClaudeChannel } from './claude'
import { createWorkspaceChannel, type WorkspaceChannel } from './workspace'
import { createSettingsChannel, type SettingsChannel } from './settings'
import { createGitChannel, type GitChannel } from './git'
import { createFsChannel, type FsChannel } from './fs'
import { createSnippetsChannel, type SnippetsChannel } from './snippets'
import { createProfileChannel, type ProfileChannel } from './profile'

export interface Channels {
  pty: PtyChannel
  claude: ClaudeChannel
  workspace: WorkspaceChannel
  settings: SettingsChannel
  git: GitChannel
  fs: FsChannel
  snippets: SnippetsChannel
  profile: ProfileChannel
}

export function createChannels(ws: WebSocketClient): Channels {
  return {
    pty: createPtyChannel(ws),
    claude: createClaudeChannel(ws),
    workspace: createWorkspaceChannel(ws),
    settings: createSettingsChannel(ws),
    git: createGitChannel(ws),
    fs: createFsChannel(ws),
    snippets: createSnippetsChannel(ws),
    profile: createProfileChannel(ws),
  }
}

export { type PtyChannel, type ClaudeChannel, type WorkspaceChannel, type SettingsChannel, type GitChannel, type FsChannel, type SnippetsChannel, type ProfileChannel }
