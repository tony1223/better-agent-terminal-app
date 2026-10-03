import type { SessionMeta } from '@/types'

export const CODEX_SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const
export const CODEX_APPROVAL_POLICIES = ['untrusted', 'on-request', 'on-failure', 'never'] as const

/** The live host wins over the workspace's creation-time defaults. */
export function resolveCodexPermissions(meta?: SessionMeta | null, params?: { sandboxMode?: unknown; approvalPolicy?: unknown }) {
  const sandbox = [meta?.codexSandboxMode, params?.sandboxMode].find(
    (value): value is typeof CODEX_SANDBOX_MODES[number] => (CODEX_SANDBOX_MODES as readonly unknown[]).includes(value),
  )
  const approval = [meta?.codexApprovalPolicy, params?.approvalPolicy].find(
    (value): value is typeof CODEX_APPROVAL_POLICIES[number] => (CODEX_APPROVAL_POLICIES as readonly unknown[]).includes(value),
  )
  return { codexSandboxMode: sandbox, codexApprovalPolicy: approval }
}
