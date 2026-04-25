# Mobile BlueStacks Test Plan

Target app: `com.batmobile`
Primary emulator: BlueStacks `127.0.0.1:53561`
ADB tool: `C:\workspaces\tonyq\agent-adb-control\target\debug\adb-agent.exe`
BlueStacks ADB: `C:\Program Files\BlueStacks_nxt\HD-Adb.exe`

## Setup

1. Build debug APK with `android\gradlew.bat :app:assembleDebug`.
2. Connect BlueStacks through `127.0.0.1:53561`.
3. Install `android\app\build\outputs\apk\debug\app-debug.apk`.
4. Start Metro on `8081`.
5. Run `adb reverse tcp:8081 tcp:8081` for the BlueStacks session.
6. Launch `com.batmobile/.MainActivity`.

## Connection Cases

1. Manual host creation
   - Add host name, address, token, and TLS fingerprint.
   - Leave default port as `9876` unless testing a non-default port.
   - Expected: host card appears with `wss://<host>:9876` and TLS badge.

2. Saved host connection
   - Tap the saved host.
   - Expected: app reaches Main tabs and `Workspaces` loads without alert or red error state.

3. QR/deep payload compatibility
   - Use JSON QR payload and URL payload forms.
   - Expected: both parse to the same host, token, fingerprint, mode, and optional context.

4. Bad endpoint
   - Use an unreachable IP or wrong port.
   - Expected: recoverable connection error, app stays usable, saved host remains editable.

5. Bad fingerprint
   - Use a valid endpoint with one changed fingerprint byte.
   - Expected: TLS fingerprint mismatch is shown and no workspace data is loaded.

## Workspace Cases

1. Workspace list initial load
   - After connect, inspect `Workspaces`.
   - Expected: remote workspaces are listed with name and path.

2. Workspace selection
   - Tap `better-agent-terminal-app`.
   - Expected: active workspace changes and app navigates to `Terminals`.

3. Workspace switching
   - Return to `Workspaces`, tap another workspace such as `browser`.
   - Expected: footer/active workspace changes, and `Terminals` list filters to that workspace.

4. Missing window context fallback
   - Connect with a stale or absent `windowId`.
   - Expected: app receives a recoverable context state, offers candidates/profile selection when needed, and can bind to a valid window.

## Session And Terminal Cases

1. Terminal list load
   - Open `Terminals`.
   - Expected: current workspace sessions/terminals appear without overlapping the bottom tab.

2. Plain terminal detail
   - Open a non-agent terminal.
   - Expected: terminal WebView is visible, a header/back control exists, bottom special-key toolbar is fully visible, and the bottom tab is hidden.

3. Terminal input
   - Type a simple command such as `pwd` and press enter.
   - Expected: output appears in the terminal and no duplicate keystrokes are sent.

4. Special key toolbar
   - Send `Tab`, arrows, `Ctrl+C`, and `Esc`.
   - Expected: key bytes are sent to the active PTY and toolbar buttons are not clipped.

5. Agent session detail
   - Open a Claude/Codex/Gemini session from the terminal list.
   - Expected: agent-specific screen opens when the session has an SDK preset; otherwise terminal detail opens.

6. Session navigation recovery
   - Enter terminal detail, press Android back, then reopen a different session.
   - Expected: tab bar is restored on list screens and hidden again on detail screens.

## Layout Cases

1. 1080x1920 / 240 dpi BlueStacks portrait
   - Expected: no bottom tab overlap, no clipped toolbar, readable list rows.

2. Physical S24+ portrait
   - Expected: safe-area bottom does not obscure terminal toolbar or tab labels.

3. Rotation or resized emulator window
   - Expected: terminal resizes and sends PTY resize updates.

## Current Fix Focus

1. Remove negative tab bar margin that overlaps list footer and terminal toolbar.
2. Hide bottom tab bar on terminal detail screens.
3. Show a normal terminal header/back path while inside terminal detail.
4. Verify workspace selection and terminal/session navigation on BlueStacks.
