import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useFocusEffect } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { useConnectionStore } from '@/stores/connection-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { appColors, fontSize, spacing } from '@/theme/colors'
import {
  getAgentPreset,
  normalizeAgentPresetsFromHost,
  type AgentPreset,
  type AgentPresetId,
  type TerminalInstance,
} from '@/types'

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
const TABS: Array<{ id: DetailTab; labelKey: string }> = [
  { id: 'sessions', labelKey: 'workspaceDetail.tab.sessions' },
  { id: 'files', labelKey: 'workspaceDetail.tab.files' },
  { id: 'git', labelKey: 'workspaceDetail.tab.git' },
  { id: 'github', labelKey: 'workspaceDetail.tab.github' },
]

export function WorkspaceDetailScreen({ route, navigation }: Props) {
  const { t } = useTranslation()
  const workspaceId = route.params?.workspaceId as string | undefined
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const switchWorkspace = useWorkspaceStore(s => s.switchWorkspace)
  const workspace = workspaces.find(w => w.id === workspaceId)
  const [activeTab, setActiveTab] = useState<DetailTab>('sessions')

  useEffect(() => {
    if (workspaceId) switchWorkspace(workspaceId)
  }, [switchWorkspace, workspaceId])

  // Refresh workspace/terminal state from the host on focus, then keep the
  // viewed workspace active, so sessions changed elsewhere stay in sync.
  useFocusEffect(
    useCallback(() => {
      const store = useWorkspaceStore.getState()
      store.load()
        .then(() => { if (workspaceId) store.switchWorkspace(workspaceId) })
        .catch(() => {})
    }, [workspaceId]),
  )

  useEffect(() => {
    navigation.setOptions({
      title: workspace?.alias || workspace?.name || t('workspaceDetail.title.workspace'),
      headerStyle: { backgroundColor: appColors.surface },
      headerTintColor: appColors.text,
    })
  }, [navigation, workspace, t])

  if (!workspace) {
    return (
      <View style={styles.centerPane}>
        <Text style={styles.emptyTitle}>{t('workspaceDetail.empty.workspaceNotFound')}</Text>
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
              {t(tab.labelKey)}
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

// A transient "not connected" during the initial connect or a reconnect blip is
// not a real failure, so we shouldn't surface it as a blocking alert.
function isNotConnectedError(e: unknown): boolean {
  return e instanceof Error && /not connected to remote server/i.test(e.message)
}

function SessionsPane({ workspaceId, navigation }: { workspaceId: string; navigation: any }) {
  const { t } = useTranslation()
  const channels = useConnectionStore(s => s.channels)
  const connectionStatus = useConnectionStore(s => s.status)
  const allTerminals = useWorkspaceStore(s => s.terminals)
  const setActiveTerminal = useWorkspaceStore(s => s.setActiveTerminal)
  const requestAddSession = useWorkspaceStore(s => s.requestAddSession)
  const requestCloseSession = useWorkspaceStore(s => s.requestCloseSession)
  const [showAddModal, setShowAddModal] = useState(false)
  const [availableSessionTypes, setAvailableSessionTypes] = useState<AgentPreset[] | null>(null)
  const [loadingTypes, setLoadingTypes] = useState(false)
  const [creatingType, setCreatingType] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)
  const createRequestRef = useRef(0)
  const terminals = useMemo(
    () => allTerminals.filter(item => item.workspaceId === workspaceId),
    [allTerminals, workspaceId],
  )
  const sessionTypeRows = useMemo(() => availableSessionTypes ?? [], [availableSessionTypes])

  const loadSupportedSessionTypes = useCallback(async () => {
    if (!channels) return
    setLoadingTypes(true)
    try {
      const presets = await channels.agent.listPresets()
        .then(normalizeAgentPresetsFromHost)
        .catch(() => [])
      if (presets.length > 0) {
        setAvailableSessionTypes(presets)
        return
      }

      const ids = await channels.agent.getSupportedSessionTypes()
      setAvailableSessionTypes(normalizeAgentPresetsFromHost(ids))
    } catch (e) {
      // Leave the list unloaded so the status-driven effect retries once we're
      // connected again, instead of blocking with an alert on a transient blip.
      if (isNotConnectedError(e)) return
      setAvailableSessionTypes([])
      Alert.alert(t('workspaceDetail.alerts.loadSessionTypesFailed'), String(e))
    } finally {
      setLoadingTypes(false)
    }
  }, [channels, t])

  // Only load (and reload) once the socket is actually connected, so the initial
  // connect / reconnect race can't fire an invoke before the server is ready.
  useEffect(() => {
    if (connectionStatus === 'connected') loadSupportedSessionTypes()
  }, [connectionStatus, loadSupportedSessionTypes])

  const openSession = (terminal: TerminalInstance) => {
    setActiveTerminal(terminal.id)
    const screen = terminal.agentPreset && SDK_AGENT_PRESETS.has(terminal.agentPreset) ? 'Claude' : 'Terminal'
    const params = screen === 'Claude' ? { sessionId: terminal.id } : { terminalId: terminal.id }
    // Push within this (Workspaces) stack so back returns to the workspace,
    // then to the list — instead of stranding the user on the Terminals tab.
    navigation.navigate(screen, params)
  }

  const addSession = async (presetId: string) => {
    const agentPreset = presetId === 'none' ? undefined : presetId as AgentPresetId
    const requestId = createRequestRef.current + 1
    createRequestRef.current = requestId
    setCreatingType(presetId)
    try {
      const terminal = await requestAddSession(workspaceId, agentPreset)
      if (createRequestRef.current !== requestId) {
        try {
          await requestCloseSession(terminal.id)
        } catch (cancelError) {
          Alert.alert(t('workspaceDetail.alerts.cancelSessionFailed'), String(cancelError))
        }
        return
      }
      setShowAddModal(false)
      const screen = terminal.agentPreset && SDK_AGENT_PRESETS.has(terminal.agentPreset) ? 'Claude' : 'Terminal'
      const params = screen === 'Claude' ? { sessionId: terminal.id } : { terminalId: terminal.id }
      navigation.navigate(screen, params)
    } catch (e) {
      if (createRequestRef.current === requestId) {
        Alert.alert(t('workspaceDetail.alerts.addSessionFailed'), String(e))
      }
    } finally {
      if (createRequestRef.current === requestId) {
        setCreatingType(null)
      }
    }
  }

  const dismissAddModal = () => {
    if (creatingType) {
      createRequestRef.current += 1
      setCreatingType(null)
    }
    setShowAddModal(false)
  }

  const closeSession = (terminal: TerminalInstance) => {
    Alert.alert(
      t('workspaceDetail.alerts.closeSessionTitle'),
      t('workspaceDetail.alerts.closeSessionMessage', { name: terminal.alias || terminal.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('workspaceDetail.button.close'),
          style: 'destructive',
          onPress: async () => {
            setClosingId(terminal.id)
            try {
              await requestCloseSession(terminal.id)
            } catch (e) {
              Alert.alert(t('workspaceDetail.alerts.closeSessionFailed'), String(e))
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
        <Text style={styles.sessionToolbarTitle}>{t('workspaceDetail.title.sessions')}</Text>
        <TouchableOpacity
          style={styles.smallButton}
          onPress={() => {
            setShowAddModal(true)
            if (!availableSessionTypes) {
              loadSupportedSessionTypes().catch(() => undefined)
            }
          }}
        >
          <Text style={styles.smallButtonText}>{t('workspaceDetail.button.add')}</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={terminals}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<EmptyMessage title={t('workspaceDetail.empty.noSessionsTitle')} body={t('workspaceDetail.empty.noSessionsBody')} />}
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
                    <Text style={styles.closeSessionText}>{t('workspaceDetail.button.close')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          )
        }}
      />
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={dismissAddModal}
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('workspaceDetail.modal.addSession')}</Text>
            <TouchableOpacity style={styles.smallButton} onPress={dismissAddModal}>
              <Text style={styles.smallButtonText}>{creatingType ? t('common.cancel') : t('workspaceDetail.button.close')}</Text>
            </TouchableOpacity>
          </View>
          {loadingTypes && sessionTypeRows.length === 0 ? (
            <LoadingState />
          ) : (
            <FlatList
              data={sessionTypeRows}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={<EmptyMessage title={t('workspaceDetail.empty.noSessionTypesTitle')} body={t('workspaceDetail.empty.noSessionTypesBody')} />}
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
  const { t } = useTranslation()
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
    setPreview({ title: entry.name, body: t('workspaceDetail.status.loading') })
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
          <Text style={styles.smallButtonText}>{t('workspaceDetail.button.up')}</Text>
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
          ListEmptyComponent={<EmptyMessage title={t('workspaceDetail.empty.noFilesTitle')} body={error || t('workspaceDetail.empty.noFilesBody')} />}
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
  const { t } = useTranslation()
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
    setDiff({ file: file.file, text: t('workspaceDetail.status.loadingDiff') })
    try {
      const text = await channels.git.diff(cwd, 'working', file.file)
      setDiff({ file: file.file, text: text || t('workspaceDetail.git.noTextDiff') })
    } catch (e) {
      setDiff({ file: file.file, text: String(e) })
    }
  }

  const isGitRepository = Boolean(root || branch)

  return (
    <View style={styles.pane}>
      <View style={styles.summaryPanel}>
        <Text style={styles.summaryTitle}>{branch || t('workspaceDetail.git.notARepository')}</Text>
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
            title={isGitRepository ? t('workspaceDetail.git.workingTreeClean') : t('workspaceDetail.git.noRepository')}
            body={loading ? t('workspaceDetail.status.loading') : isGitRepository ? t('workspaceDetail.git.noModifiedFiles') : t('workspaceDetail.git.statusUnavailable')}
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
  const { t } = useTranslation()
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
        <Text style={styles.summaryTitle}>{t('workspaceDetail.github.title')}</Text>
        <Text style={styles.mutedText}>
          {t('workspaceDetail.github.cliStatus', {
            installed: cli?.installed ? t('workspaceDetail.github.installed') : t('workspaceDetail.github.missing'),
            auth: cli?.authenticated ? t('workspaceDetail.github.authenticated') : t('workspaceDetail.github.notAuthenticated'),
          })}
        </Text>
        {repoUrl ? (
          <TouchableOpacity onPress={() => Linking.openURL(repoUrl)}>
            <Text style={styles.linkText} numberOfLines={1}>{repoUrl}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.mutedText}>{t('workspaceDetail.github.noRemote')}</Text>
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
      <Text style={styles.sectionTitle}>{t('workspaceDetail.github.pullRequests')}</Text>
      {prs.length === 0 ? <Text style={styles.emptyInline}>{t('workspaceDetail.github.noPullRequests')}</Text> : prs.map(item => <GitHubListItem key={`pr-${item.number}`} item={item} prefix="PR" />)}
      <Text style={styles.sectionTitle}>{t('workspaceDetail.github.issues')}</Text>
      {issues.length === 0 ? <Text style={styles.emptyInline}>{t('workspaceDetail.github.noIssues')}</Text> : issues.map(item => <GitHubListItem key={`issue-${item.number}`} item={item} prefix="Issue" />)}
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
  const { t } = useTranslation()
  return (
    <Modal visible={!!preview} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={1}>{preview?.title}</Text>
          <TouchableOpacity style={styles.smallButton} onPress={onClose}>
            <Text style={styles.smallButtonText}>{t('workspaceDetail.button.close')}</Text>
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
