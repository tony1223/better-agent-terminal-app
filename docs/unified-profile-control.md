# Unified Profile Control for BAT Mobile

Status: implemented in BAT Mobile and BAT Desktop; awaiting device acceptance and
release. Both applications need the updated code for remote profile selection.
The adjacent send-result fix is included in the mobile working tree.

## Implementation Notes

- BAT owns connection-bound `profile:open`, `profile:close`, and `profile:status`.
  Existing invoke/event envelopes carry an optional opaque `contextId`.
- `profile_context.rs` resolves local/remote targets, validates the original alias,
  translates workspace profile IDs, and scopes events to interested resources.
- Each remote context has its own outbound consumer and event sink. This costs an
  extra socket per open profile but avoids sharing the desktop's single-owner event
  subscription. It reuses the existing TLS client implementation.
- Mobile channel factories use a common transport interface. Profile catalog and
  entry-host maintenance remain on root channels; execution channels use the context.
- Context replacement rejects stale operations/results. Conversation state and
  recents are scoped by the execution binding; usage and previews reset on a switch.
- Reconnection reopens the selected profile. A stable view key preserves navigation
  on reconnect; switching targets resets navigation to the workspace list.
- Three bounded retries precede manual retry for an unavailable profile. Failed sends
  stay retryable, and opening a conversation continues to use client-resume.
- Hosts without the capability retain local-profile behavior. Remote selection
  explicitly requires a host update instead of falling back to local execution.

Automated verification includes mobile transport/store tests, desktop Rust tests,
and a headless integration fixture using separate temporary BAT hosts with real TLS
forwarding. The fixture verifies workspace reads/writes and synthetic runtime-event
delivery without starting a billable agent. Physical-device Claude/Codex, PTY,
attachments, and repository action acceptance is still required before release.

## Product Contract

Mobile has one profile picker and one workspace/session experience. BAT resolves
whether a selected profile is local or remote internally. Screens and channel
callers must not branch on profile type or ask the phone to connect to another host.

Show the selected profile name, workspace name, and ordinary loading, ready,
reconnecting, or unavailable states. Do not show relay hops, target addresses,
tokens, certificate fingerprints, or connection-pool details in this workflow.
Remote profile connection configuration remains in BAT's existing profile editor.

Selecting a profile changes this client's view, not desktop window activation.
Opening a session attaches to it; it must not restart a running agent or PTY.

## Findings in the Current Code

Paths below are relative to the named repository.

| Repository / file | Finding |
| --- | --- |
| App: `src/screens/WorkspaceListScreen.tsx` | Already uses one picker and calls `loadProfileWorkspace(profile.id)` for every entry. |
| App: `src/stores/workspace-store.ts` | Loads a profile through workspace load and snapshot fallback; its default-profile resolver excludes remote entries. It does not establish a remote target. |
| App: `src/api/channels/workspace.ts` | Workspace load/save carry profileId, but that only selects a profile on the connected BAT. |
| App: `src/api/channels/claude.ts` | Session operations carry sessionId, without a profile execution context. |
| App: `src/stores/connection-store.ts` | One connected client supplies all channels. Workspace, agent, files, and Git must agree on the execution target. |
| BAT: `src-tauri/src/commands/profile.rs` | Remote entries contain connection configuration and target profile identity. Workspace helpers read local live windows/snapshots; snapshot save requires a local profile. |
| BAT: `src-tauri/src/remote_core.rs` | `RemoteProfileEntry` already strips connection credentials and addresses from profile lists. Preserve that public contract. |
| BAT: `src-tauri/src/remote_server.rs` | Incoming operations dispatch to this BAT's Rust runtime or sidecar. Selecting a remote alias does not establish generic forwarding. |
| BAT: `src-tauri/src/remote_client.rs` | Provides outbound TLS connections and per-window bindings. Resource event ownership currently points to the most recent window, not a subscriber set. |
| BAT: `src-tauri/src/event_hub.rs` | Desktop forwarding explicitly excludes `rust-remote-client` events from global remote-server broadcasts. Removing that exclusion is not sufficient or safe routing. |

Consequently, enabling a remote picker row or returning its cached workspace alone
cannot implement remote control: subsequent sends, PTY input, file reads, and Git
operations could still execute on the entry BAT.

## Host-Owned Profile Execution

```text
App: select profile -> open context -> existing workspace/session operations
                               |
                   BAT profile execution context
                      /                     \
          Local profile target        Remote profile target
          local runtime/state         outbound BAT connection
                                      + mapped target profile
```

Both targets implement the same internal operations: attach, invoke, subscribe,
status, and release. Keep existing runtime handlers and renderer APIs; introduce
the routing boundary before runtime dispatch and session registration.

The remote target looks up credentials on BAT and pins the configured certificate.
It uses an independent consumer binding, not a desktop window identity. Closing
the mobile view releases that binding only; it must not stop sessions or disconnect
desktop consumers. Reuse connection-pool mechanics where practical, but replace
single-owner event delivery with explicit subscriber sets for shared sessions.

## Additive Protocol

The public API uses profile/context
concepts only, with the same requests and responses for both profile types.

1. Keep `profile:list` as the entry BAT's profile catalog, using safe display fields.
2. `profile:open { profileId }` returns an opaque `contextId`, `bindingKey`, profile
   display identity, and availability. The client shows loading during the bounded
   connection attempt. Effective per-operation capabilities remain future work;
   unsupported operations currently return an explicit method error.
3. Existing operation frames may carry `contextId` as envelope metadata. Channel
   payloads and event names stay compatible. BAT resolves the context before
   dispatching any operation. Scoped events carry the same contextId.
4. Add `profile:status` and `profile:close` for availability and resource release.
   Closing is idempotent and does not destroy a workspace or session.
5. Advertise a capability such as `profileContext: 1`. Absent capability keeps the
   existing local-profile workflow; remote entries show unavailable rather than
   falling through to an entry-host snapshot.

A context is owned by the authenticated connection, not a client-provided device
ID or windowId. Unknown, expired, or foreign contexts fail explicitly. Never fall
back to the entry BAT, another profile, or a default profile after routing fails.
Authorize access to the alias before opening its outbound binding.

Use immutable contexts per open. Switching to B must not retarget a request already
issued for A. If an alias is edited to point elsewhere, invalidate its old context
and require a new open, rather than redirecting in-flight work.

The first implementation supports one remote target hop and rejects a remote
alias as the downstream target. This avoids recursive routing and cycles while
covering phone -> entry BAT -> execution BAT. Multi-hop support is a later decision.

## Operation Scope

| Operation | Owner |
| --- | --- |
| Profile catalog and context lifecycle | Entry BAT |
| Workspace load/save and session creation | Selected context's execution target |
| Agent history, client-resume, send, abort, approvals and tools | Selected context's execution target |
| PTY attach, input, resize, snapshots and output | Selected context's execution target |
| Files, attachment upload, Git, GitHub and worktree actions | Selected context's execution target |
| Connection management and entry BAT diagnostics | Entry BAT |
| Runtime models/settings needed by a session | Selected context's execution target |

Map the alias to the downstream profile at BAT, including workspace load/save
profileId rewriting and validation. Do not forward an alias ID as if it were a
downstream profile ID. Validate operation scope, and reject context-scoped commands
that lack an implemented route instead of silently dispatching them locally.

Attachment upload and message send must use the same context: an uploaded path on
the entry BAT is not a valid attachment path on the execution BAT.

Downstream profile-change events update the context's status/metadata. They must
not replace the entry BAT's catalog in the phone. Workspace and session events
are delivered only to subscribed contexts, preserving their existing payloads.

## App Integration and Resume

- Put context handling below `createChannels`, in a scoped transport facade. Keep
  screens independent of local/remote routing. Keep root catalog channels separate
  internally from context-scoped operation channels.
- Store selected profile identity independently from desktop active profile IDs.
  Use a selection generation to discard late open/load completions.
- Scope cached sessions, pending sends, previews, usage, recents, and recovery
  callbacks by connection/profile identity plus resource ID. IDs such as `default`
  and copied session IDs can exist on more than one host.
- An ephemeral contextId is a delivery boundary, not a persistent cache key. Across
  reconnect, restore cached data only after the host confirms the same target
  binding; an alias redirected to a different target must not reuse old data.
- On a transient target outage, retain the conversation and expose reconnecting.
  Distinguish that from the phone losing its connection to the entry BAT internally,
  without requiring the user to understand network hops.
- After transport reconnect, reopen the selected profile, install scoped event
  subscriptions, then load workspaces and attach the visible session. Buffer events
  until the initial snapshot is reconciled, or use a revision/cursor handshake.
- Use `clientResume` on the execution target for history/reattachment. Normal view
  opening and reconnection must not call stopSession or destructive resumeSession.
- Preserve failed/pending local sends through snapshot merges. Do not automatically
  resend after a timeout: delivery may have succeeded. Exactly-once retry requires
  a supported client message ID and host deduplication; do not claim that guarantee
  from matching text/timestamps. Session repair is limited to explicit missing-runtime
  failures and must remain tied to the original context.
- If the alias or target profile is deleted, show unavailable and allow another
  selection. Never send a pending message to a replacement/default profile.

## Implementation Order

1. BAT: add profile context resolution, ownership, local dispatch and protocol tests.
   Exercise the same context contract for local profiles first.
2. BAT: add remote target invoke/event delivery, subscriber lifecycle, profile ID
   mapping, capability negotiation, and bounded reconnect behavior.
3. App: add the scoped transport and shared selection state, migrate channel/store
   subscriptions, and keep the existing picker and session screens.
4. Verify Claude and Codex read/send/resume, including attachments, before enabling
   PTY and repository mutations through the context. Advertise only verified features.

## Acceptance Cases

Run contract tests against both local and remote targets wherever applicable.

| Case | Required result |
| --- | --- |
| Open local or remote profile | Same picker, workspace list, headers and actions; no connection configuration required. |
| Switch A -> B while A loads | Only B appears; late A data cannot overwrite B. |
| Desktop and phone view the same session | Both receive output; neither steals the other's subscription. |
| Two phones view different targets with identical IDs | No mixed events, cached messages, requests or recovery callbacks. |
| Add Claude/Codex session | Saved on the selected execution target and immediately reflected in its list. |
| Send a unique harmless test prompt | One delivery on the selected target with a visible remote response. |
| Read/resume a streaming session | History plus ongoing output, without stopping the desktop turn. |
| Missing runtime and send failure | One context-bound recovery attempt; failed input remains retryable. |
| Lost send acknowledgement | Pending input survives refresh; no blind automatic resend. |
| Image attachment | Uploaded and read on the execution target; no path from another target is used. |
| Entry link or target link drops | Correct reconnect state, preserved transcript, scoped reattachment. |
| Alias edited/deleted or target profile removed | Context invalidated; no fallback write or redirected pending send. |
| Close mobile view | Only mobile subscription released; desktop work continues. |
| PTY and repository operations | Execute on the selected target with matching scoped output/results. |
| Invalid context, recursive alias, unsupported capability | Explicit error; never local execution fallback. |
| Profile lists, events, logs and persisted App state | No target token or TLS credential disclosure. |

Use isolated test profiles/repositories for mutation cases. Do not stop existing
user agents, delete workspaces, or perform merges in an existing working project.
