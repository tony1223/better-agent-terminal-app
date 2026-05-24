import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useConnectionStore } from '@/stores/connection-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { appColors, fontSize, spacing } from '@/theme/colors'
import { AGENT_PRESETS, getAgentPreset, type AgentPresetId, type TerminalInstance } from '@/types'

type Props = NativeStackScreenProps<any, 'WorkspaceDetail'>

type DetailTab = 'sessions' | 'files' | 'git' | 'github'

interface FsEntry {
  name: string
  path: string
  isDirectory: boolean
}

interface GitFileEntry {
  status: string
  file: string
}

interface GitHubItem {
  number?: number
  title?: string
  state?: string
  author?: { login?: string } | string
  headRefName?: string
  isDraft?: boolean
  updatedAt?: string
}

const SDK_AGENT_PRESETS = new Set(['claude-code', 'claude-code-v2', 'claude-code-worktree', 'codex-agent', 'codex-agent-worktree', 'openai-agent'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'])
const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'files', label: 'Files' },
  { id: 'git', label: 'Git' },
  { id: 'github', label: 'GitHub' },
]

export function WorkspaceDetailScreen({ route, navigation }: Props) {
  const workspaceId = route.params?.workspaceId as string | undefined
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const switchWorkspace = useWorkspaceStore(s => s.switchWorkspace)
  const workspace = workspaces.find(w => w.id === workspaceId)
  const [activeTab, setActiveTab] = useState<DetailTab>('sessions')

  useEffect(() => {
    if (workspaceId) switchWorkspace(workspaceId)
  }, [switchWorkspace, workspaceId])

  useEffect(() => {
    navigation.setOptions({
      title: workspace?.alias || workspace?.name || 'Workspace',
      headerStyle: { backgroundColor: appColors.surface },
      headerTintColor: appColors.text,
    })
  }, [navigation, workspace])

  if (!workspace) {
    return (
      <View style={styles.centerPane}>
        <Text style={styles.emptyTitle}>Workspace not found</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.contextHeader}>
        <Text style={styles.contextName} numberOfLines={1}>{workspace.alias || workspace.name}</Text>
        <Text style={styles.contextPath} numberOfLines={1}>{workspace.folderPath}</Text>
      </View>
      <View style={styles.tabs}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tabButton, activeTab === tab.id && styles.tabButtonActive]}
            onPress={() => setActiveTab(tab.id)}
          >
            <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {activeTab === 'sessions' && <SessionsPane workspaceId={workspace.id} navigation={navigation} />}
      {activeTab === 'files' && <FilesPane rootPath={workspace.folderPath} />}
      {activeTab === 'git' && <GitPane cwd={workspace.folderPath} />}
      {activeTab === 'github' && <GitHubPane cwd={workspace.folderPath} />}
    </View>
  )
}

function SessionsPane({ workspaceId, navigation }: { workspaceId: string; navigation: any }) {
  const channels = useConnectionStore(s => s.channels)
  const allTerminals = useWorkspaceStore(s => s.terminals)
  const setActiveTerminal = useWorkspaceStore(s => s.setActiveTerminal)
  const requestAddSession = useWorkspaceStore(s => s.requestAddSession)
  const requestCloseSession = useWorkspaceStore(s => s.requestCloseSession)
  const [showAddModal, setShowAddModal] = useState(false)
  const [supportedSessionTypes, setSupportedSessionTypes] = useState<Set<string> | null>(null)
  const [loadingTypes, setLoadingTypes] = useState(false)
  const [creatingType, setCreatingType] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)
  const terminals = useMemo(
    () => allTerminals.filter(t => t.workspaceId === workspaceId),
    [allTerminals, workspaceId],
  )
  const availableSessionTypes = useMemo(
    () => supportedSessionTypes
      ? AGENT_PRESETS.filter(preset => supportedSessionTypes.has(preset.id))
      : [],
    [supportedSessionTypes],
  )

  const loadSupportedSessionTypes = useCallback(async () => {
    if (!channels) return
    setLoadingTypes(true)
    try {
      const ids = await channels.agent.getSupportedSessionTypes()
      setSupportedSessionTypes(new Set((ids || []).map(String)))
    } catch (e) {
      setSupportedSessionTypes(new Set())
      Alert.alert('Unable to load session types', String(e))
    } finally {
      setLoadingTypes(false)
    }
  }, [channels])

  useEffect(() => { loadSupportedSessionTypes() }, [loadSupportedSessionTypes])

  const openSession = (terminal: TerminalInstance) => {
    setActiveTerminal(terminal.id)
    const screen = terminal.agentPreset && SDK_AGENT_PRESETS.has(terminal.agentPreset) ? 'Claude' : 'Terminal'
    const params = screen === 'Claude' ? { sessionId: terminal.id } : { terminalId: terminal.id }
    navigation.getParent?.()?.navigate('Terminals', { screen, params })
  }

  const addSession = async (presetId: string) => {
    const agentPreset = presetId === 'none' ? undefined : presetId as AgentPresetId
    setCreatingType(presetId)
    try {
      const terminal = await requestAddSession(workspaceId, agentPreset)
      setShowAddModal(false)
      const screen = terminal.agentPreset && SDK_AGENT_PRESETS.has(terminal.agentPreset) ? 'Claude' : 'Terminal'
      const params = screen === 'Claude' ? { sessionId: terminal.id } : { terminalId: terminal.id }
      navigation.getParent?.()?.navigate('Terminals', { screen, params })
    } catch (e) {
      Alert.alert('Unable to add session', String(e))
    } finally {
      setCreatingType(null)
    }
  }

  const closeSession = (terminal: TerminalInstance) => {
    Alert.alert(
      'Close Session',
      `Close "${terminal.alias || terminal.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          style: 'destructive',
          onPress: async () => {
            setClosingId(terminal.id)
            try {
              await requestCloseSession(terminal.id)
            } catch (e) {
              Alert.alert('Unable to close session', String(e))
            } finally {
              setClosingId(null)
            }
          },
        },
      ],
    )
  }

  return (
    <View style={styles.pane}>
      <View style={styles.sessionToolbar}>
        <Text style={styles.sessionToolbarTitle}>Sessions</Text>
        <TouchableOpacity
          style={styles.smallButton}
          onPress={() => {
            setShowAddModal(true)
            if (!supportedSessionTypes) {
              loadSupportedSessionTypes().catch(() => undefined)
            }
          }}
        >
          <Text style={styles.smallButtonText}>Add</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={terminals}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<EmptyMessage title="No sessions" body="No terminal or agent sessions are attached to this workspace." />}
        renderItem={({ item }) => {
          const preset = item.agentPreset ? getAgentPreset(item.agentPreset) : null
          const isClosing = closingId === item.id
          return (
            <TouchableOpacity style={styles.card} onPress={() => openSession(item)} disabled={isClosing}>
              <View style={styles.row}>
                <Text style={[styles.leadingIcon, preset && { color: preset.color }]}>
                  {preset?.icon || '>'}
                </Text>
                <View style={styles.flex}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{item.alias || item.title}</Text>
                  <Text style={styles.mutedMono} numberOfLines={1}>{item.cwd}</Text>
                </View>
                {isClosing ? (
                  <ActivityIndicator size="small" color={appColors.accent} />
                ) : (
                  <TouchableOpacity style={styles.closeSessionButton} onPress={() => closeSession(item)}>
                    <Text style={styles.closeSessionText}>Close</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          )
        }}
      />
      <Modal visible={showAddModal} animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Session</Text>
            <TouchableOpacity style={styles.smallButton} onPress={() => setShowAddModal(false)}>
              <Text style={styles.smallButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
          {loadingTypes && availableSessionTypes.length === 0 ? (
            <LoadingState />
          ) : (
            <FlatList
              data={availableSessionTypes}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={<EmptyMessage title="No session types" body="The host did not report any supported session types." />}
              renderItem={({ item }) => {
                const isCreating = creatingType === item.id
                return (
                  <TouchableOpacity
                    style={styles.card}
                    disabled={!!creatingType}
                    onPress={() => addSession(item.id)}
                  >
                    <View style={styles.row}>
                      <Text style={[styles.leadingIcon, { color: item.color }]}>{item.icon}</Text>
                      <View style={styles.flex}>
                        <Text style={styles.cardTitle}>{item.name}</Text>
                      </View>
                      {isCreating && <ActivityIndicator size="small" color={appColors.accent} />}
                    </View>
                  </TouchableOpacity>
                )
              }}
            />
          )}
        </View>
      </Modal>
    </View>
  )
}

function FilesPane({ rootPath }: { rootPath: string }) {
  const channels = useConnectionStore(s => s.channels)
  const [currentPath, setCurrentPath] = useState(rootPath)
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ title: string; body?: string; imageUrl?: string; error?: string } | null>(null)

  useEffect(() => setCurrentPath(rootPath), [rootPath])

  const load = useCallback(async () => {
    if (!channels) return
    setLoading(true)
    setError(null)
    try {
      const raw = await channels.fs.readdir(currentPath)
      setEntries(normalizeFsEntries(raw))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [channels, currentPath])

  useEffect(() => { load() }, [load])

  const openEntry = async (entry: FsEntry) => {
    if (!channels) return
    if (entry.isDirectory) {
      setCurrentPath(entry.path)
      return
    }
    const ext = fileExt(entry.name)
    setPreview({ title: entry.name, body: 'Loading...' })
    try {
      if (IMAGE_EXTS.has(ext)) {
        const imageUrl = await channels.fs.readImageAsDataUrl(entry.path)
        setPreview({ title: entry.name, imageUrl })
        return
      }
      const result = await channels.fs.readFile(entry.path)
      setPreview({
        title: entry.name,
        body: result.content ?? '',
        error: result.error,
      })
    } catch (e) {
      setPreview({ title: entry.name, error: String(e) })
    }
  }

  return (
    <View style={styles.pane}>
      <View style={styles.pathBar}>
        <TouchableOpacity
          style={styles.smallButton}
          onPress={() => setCurrentPath(parentPath(currentPath))}
          disabled={normalizePath(currentPath) === normalizePath(rootPath)}
        >
          <Text style={styles.smallButtonText}>Up</Text>
        </TouchableOpacity>
        <Text style={styles.pathBarText} numberOfLines={1}>{currentPath}</Text>
      </View>
      {loading && entries.length === 0 ? (
        <LoadingState />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={item => item.path}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={appColors.accent} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<EmptyMessage title="No files" body={error || 'This directory is empty or unavailable.'} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.compactRow} onPress={() => openEntry(item)}>
              <Text style={styles.fileIcon}>{item.isDirectory ? 'dir' : fileExt(item.name) || 'file'}</Text>
              <View style={styles.flex}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.mutedMono} numberOfLines={1}>{item.path}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
      <PreviewModal preview={preview} onClose={() => setPreview(null)} />
    </View>
  )
}

function GitPane({ cwd }: { cwd: string }) {
  const channels = useConnectionStore(s => s.channels)
  const [branch, setBranch] = useState<string | null>(null)
  const [root, setRoot] = useState<string | null>(null)
  const [files, setFiles] = useState<GitFileEntry[]>([])
  const [diff, setDiff] = useState<{ file: string; text: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!channels) return
    setLoading(true)
    setError(null)
    try {
      const [nextBranch, nextRoot, nextFiles] = await Promise.all([
        channels.git.branch(cwd).catch(() => null),
        channels.git.getRoot(cwd).catch(() => null),
        channels.git.status(cwd).catch(() => []),
      ])
      setBranch(nextBranch)
      setRoot(nextRoot)
      setFiles(normalizeGitFiles(nextFiles))
      setDiff(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [channels, cwd])

  useEffect(() => { load() }, [load])

  const openDiff = async (file: GitFileEntry) => {
    if (!channels) return
    setDiff({ file: file.file, text: 'Loading diff...' })
    try {
      const text = await channels.git.diff(cwd, 'working', file.file)
      setDiff({ file: file.file, text: text || '(No text diff available.)' })
    } catch (e) {
      setDiff({ file: file.file, text: String(e) })
    }
  }

  const isGitRepository = Boolean(root || branch)

  return (
    <View style={styles.pane}>
      <View style={styles.summaryPanel}>
        <Text style={styles.summaryTitle}>{branch || 'Not a git repository'}</Text>
        <Text style={styles.mutedMono} numberOfLines={1}>{root || cwd}</Text>
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
      <FlatList
        data={files}
        keyExtractor={(item, index) => `${item.status}:${item.file}:${index}`}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={appColors.accent} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={(
          <EmptyMessage
            title={isGitRepository ? 'Working tree clean' : 'No git repository'}
            body={loading ? 'Loading...' : isGitRepository ? 'No modified files.' : 'Git status is unavailable for this workspace.'}
          />
        )}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.compactRow} onPress={() => openDiff(item)}>
            <Text style={styles.statusBadge}>{item.status || '?'}</Text>
            <Text style={styles.fileName} numberOfLines={1}>{item.file}</Text>
          </TouchableOpacity>
        )}
      />
      <PreviewModal
        preview={diff ? { title: diff.file, body: diff.text } : null}
        onClose={() => setDiff(null)}
      />
    </View>
  )
}

function GitHubPane({ cwd }: { cwd: string }) {
  const channels = useConnectionStore(s => s.channels)
  const [repoUrl, setRepoUrl] = useState<string | null>(null)
  const [cli, setCli] = useState<{ installed?: boolean; authenticated?: boolean } | null>(null)
  const [prs, setPrs] = useState<GitHubItem[]>([])
  const [issues, setIssues] = useState<GitHubItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!channels) return
    setLoading(true)
    setError(null)
    try {
      const [nextUrl, nextCli, nextPrs, nextIssues] = await Promise.all([
        channels.git.getGithubUrl(cwd).catch(() => null),
        channels.github.checkCli().catch(() => null),
        channels.github.prList(cwd).catch(e => ({ error: String(e) })),
        channels.github.issueList(cwd).catch(e => ({ error: String(e) })),
      ])
      setRepoUrl(nextUrl)
      setCli(nextCli)
      const prResult = normalizeGithubList(nextPrs)
      const issueResult = normalizeGithubList(nextIssues)
      setPrs(prResult.items)
      setIssues(issueResult.items)
      setError(prResult.error || issueResult.error || null)
    } finally {
      setLoading(false)
    }
  }, [channels, cwd])

  useEffect(() => { load() }, [load])

  return (
    <ScrollView
      style={styles.pane}
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={appColors.accent} />}
    >
      <View style={styles.summaryPanel}>
        <Text style={styles.summaryTitle}>GitHub</Text>
        <Text style={styles.mutedText}>
          gh: {cli?.installed ? 'installed' : 'missing'} / {cli?.authenticated ? 'authenticated' : 'not authenticated'}
        </Text>
        {repoUrl ? (
          <TouchableOpacity onPress={() => Linking.openURL(repoUrl)}>
            <Text style={styles.linkText} numberOfLines={1}>{repoUrl}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.mutedText}>No GitHub remote detected.</Text>
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
      <Text style={styles.sectionTitle}>Pull Requests</Text>
      {prs.length === 0 ? <Text style={styles.emptyInline}>No open pull requests.</Text> : prs.map(item => <GitHubListItem key={`pr-${item.number}`} item={item} prefix="PR" />)}
      <Text style={styles.sectionTitle}>Issues</Text>
      {issues.length === 0 ? <Text style={styles.emptyInline}>No open issues.</Text> : issues.map(item => <GitHubListItem key={`issue-${item.number}`} item={item} prefix="Issue" />)}
    </ScrollView>
  )
}

function GitHubListItem({ item, prefix }: { item: GitHubItem; prefix: string }) {
  const author = typeof item.author === 'string' ? item.author : item.author?.login
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {prefix} #{item.number} {item.title}
      </Text>
      <Text style={styles.mutedText} numberOfLines={1}>
        {item.state || 'open'}{item.isDraft ? ' / draft' : ''}{author ? ` / ${author}` : ''}{item.headRefName ? ` / ${item.headRefName}` : ''}
      </Text>
    </View>
  )
}

function PreviewModal({
  preview,
  onClose,
}: {
  preview: { title: string; body?: string; imageUrl?: string; error?: string } | null
  onClose: () => void
}) {
  return (
    <Modal visible={!!preview} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={1}>{preview?.title}</Text>
          <TouchableOpacity style={styles.smallButton} onPress={onClose}>
            <Text style={styles.smallButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
        {preview?.imageUrl ? (
          <Image source={{ uri: preview.imageUrl }} style={styles.previewImage} resizeMode="contain" />
        ) : (
          <ScrollView style={styles.previewScroll}>
            <Text style={[styles.previewText, preview?.error && styles.errorText]}>
              {preview?.error || preview?.body || ''}
            </Text>
          </ScrollView>
        )}
      </View>
    </Modal>
  )
}

function EmptyMessage({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.emptyBox}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  )
}

function LoadingState() {
  return (
    <View style={styles.centerPane}>
      <ActivityIndicator color={appColors.accent} />
    </View>
  )
}

function normalizeFsEntries(value: unknown): FsEntry[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => ({
        name: String(item.name ?? ''),
        path: String(item.path ?? ''),
        isDirectory: Boolean(item.isDirectory ?? item.is_directory),
      }))
      .filter(item => item.name && item.path)
    : []
}

function normalizeGitFiles(value: unknown): GitFileEntry[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => ({ status: String(item.status ?? ''), file: String(item.file ?? '') }))
      .filter(item => item.file)
    : []
}

function normalizeGithubList(value: unknown): { items: GitHubItem[]; error: string | null } {
  if (Array.isArray(value)) return { items: value as GitHubItem[], error: null }
  if (value && typeof value === 'object' && 'error' in value) {
    return { items: [], error: String((value as { error?: unknown }).error ?? '') }
  }
  return { items: [], error: null }
}

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function normalizePath(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase()
}

function parentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (slash <= 0) return path
  return trimmed.slice(0, slash)
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appColors.background,
  },
  pane: {
    flex: 1,
  },
  centerPane: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appColors.background,
    padding: spacing.lg,
  },
  contextHeader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: appColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  contextName: {
    color: appColors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  contextPath: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: appColors.surface,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: 6,
  },
  tabButtonActive: {
    backgroundColor: appColors.accentDim,
  },
  tabText: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  tabTextActive: {
    color: appColors.text,
  },
  listContent: {
    padding: spacing.md,
    flexGrow: 1,
  },
  sessionToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: appColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  sessionToolbarTitle: {
    flex: 1,
    color: appColors.text,
    fontSize: fontSize.sm,
    fontWeight: '800',
  },
  card: {
    backgroundColor: appColors.surface,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  leadingIcon: {
    color: appColors.accent,
    fontSize: fontSize.lg,
    width: 30,
    marginRight: spacing.sm,
  },
  cardTitle: {
    color: appColors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  mutedText: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: 3,
  },
  mutedMono: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
    marginTop: 3,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: spacing.sm,
  },
  closeSessionButton: {
    minHeight: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    marginLeft: spacing.sm,
  },
  closeSessionText: {
    color: appColors.error,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  pathBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    backgroundColor: appColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  pathBarText: {
    flex: 1,
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
    marginLeft: spacing.sm,
  },
  smallButton: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: appColors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: appColors.surfaceHover,
  },
  smallButtonText: {
    color: appColors.text,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  fileIcon: {
    color: appColors.accent,
    fontSize: fontSize.xs,
    fontWeight: '700',
    width: 42,
    marginRight: spacing.sm,
  },
  fileName: {
    flex: 1,
    color: appColors.text,
    fontSize: fontSize.sm,
    fontFamily: 'monospace',
  },
  statusBadge: {
    width: 42,
    color: appColors.accent,
    fontSize: fontSize.sm,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  summaryPanel: {
    backgroundColor: appColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
    padding: spacing.md,
  },
  summaryTitle: {
    color: appColors.text,
    fontSize: fontSize.md,
    fontWeight: '800',
  },
  sectionTitle: {
    color: appColors.text,
    fontSize: fontSize.sm,
    fontWeight: '800',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  linkText: {
    color: appColors.accent,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  errorText: {
    color: appColors.error,
    marginTop: spacing.sm,
  },
  emptyInline: {
    color: appColors.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.sm,
  },
  emptyBox: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  emptyTitle: {
    color: appColors.text,
    fontSize: fontSize.md,
    fontWeight: '800',
  },
  emptyBody: {
    color: appColors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: appColors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    paddingTop: spacing.xl,
    backgroundColor: appColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  modalTitle: {
    flex: 1,
    color: appColors.text,
    fontSize: fontSize.md,
    fontWeight: '800',
    marginRight: spacing.md,
  },
  previewScroll: {
    flex: 1,
    padding: spacing.md,
  },
  previewText: {
    color: appColors.text,
    fontFamily: 'monospace',
    fontSize: fontSize.xs,
    lineHeight: 18,
  },
  previewImage: {
    flex: 1,
    backgroundColor: '#000000',
  },
})
