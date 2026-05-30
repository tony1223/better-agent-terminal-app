# CLAUDE.md - BAT Mobile Project Guidelines

## Related Projects

- **BAT Desktop (原始碼)**: `/Users/tonyqwang/clones/tonyq/better-agent-terminal/`
  - Tauri (Rust `src-tauri/`) + React renderer (`renderer/`) + Node sidecar (`node-sidecar/`) 桌面版 Better Agent Terminal
  - Remote Server 實作 (Rust): `src-tauri/src/remote_server.rs`
  - Remote 協定/frame 編解碼與 channel 對應 (Rust): `src-tauri/src/remote_core.rs`
  - Node sidecar agent handlers: `node-sidecar/src/handlers/`（例如 `claude-session.mjs`、`claude-history.mjs`）
  - 通知中心參考: `src-tauri/src/commands/notification.rs`、`renderer/src/stores/notification-store.ts`、`renderer/src/components/NotificationBell.tsx`
  - Renderer host API / 型別: `renderer/src/host-api.ts`
  - UI 元件參考: `renderer/src/components/`
  - Store 模式參考: `renderer/src/stores/`

## Project Overview

BAT Mobile 是 Better Agent Terminal 的 React Native 手機版（iOS + Android），透過 WebSocket 連線至 BAT Desktop 的 Remote Server，共享/控制已存在的 terminal 與 Claude agent session。

## Release（Android + iOS）

由 git tag 驅動發布，兩個 workflow 分別為 `.github/workflows/release-aab.yml`（Android AAB → Google Play）與 `.github/workflows/release-testflight.yml`（iOS → TestFlight）。

Tag 格式（皆支援開頭可選的 `v`）：

- `1.0.1` / `v1.0.1`：同時發 Android 與 iOS（兩邊用同一版號）。
- `1.0.1-android` / `v1.0.1-android`：只發 Android。
- `1.0.1-ios` / `v1.0.1-ios`：只發 iOS。

兩平台版號可各自脫鉤獨立發版（例如 Android 已在 `1.0.8`、iOS 還在 `1.0.7`，就各推各的後綴 tag）。

- `versionName` / `MARKETING_VERSION` 取自 tag：去掉開頭的 `v`，並去掉結尾的 `-android` / `-ios`（例如 `v1.0.1-ios` → `1.0.1`）。
- Android `versionCode` 與 iOS build number 由 CI 的 `github.run_number` 自動遞增，不需手動指定。
- Android 發布步驟同時上傳到 Google Play 的 `internal` 與 `beta` 兩個 track。
- 兩個 workflow 仍可用 `workflow_dispatch` 手動執行，並以 `versionName`（iOS）或 `versionCode` / `versionName`（Android）input 覆寫。

發版流程：先把 `main` push 上去（CI checkout 遠端 tag），再 push tag，例如：

```sh
# 兩邊一起發
git tag 1.0.1
git push origin 1.0.1

# 只發其中一邊
git tag 1.0.1-ios
git push origin 1.0.1-ios
```
