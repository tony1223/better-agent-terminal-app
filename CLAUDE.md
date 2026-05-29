# CLAUDE.md - BAT Mobile Project Guidelines

## Related Projects

- **BAT Desktop (原始碼)**: `/Users/tonyqwang/clones/lineage/better-agent-terminal/`
  - Electron + React + TypeScript 桌面版 Better Agent Terminal
  - WebSocket 協定定義: `electron/remote/protocol.ts`
  - Remote Server 實作: `electron/remote/remote-server.ts`
  - Remote Client 參考實作: `electron/remote/remote-client.ts`
  - 核心類型定義: `src/types/index.ts`, `src/types/claude-agent.ts`, `src/types/agent-presets.ts`
  - UI 元件參考: `src/components/`
  - Store 模式參考: `src/stores/workspace-store.ts`, `src/stores/settings-store.ts`

## Project Overview

BAT Mobile 是 Better Agent Terminal 的 React Native 手機版（iOS + Android），透過 WebSocket 連線至 BAT Desktop 的 Remote Server，共享/控制已存在的 terminal 與 Claude agent session。

## Release（Android AAB）

由 git tag 驅動發布，workflow 為 `.github/workflows/release-aab.yml`。

- 推 tag 觸發發布：tag 格式 `1.0.1` 或 `v1.0.1`（`MAJOR.MINOR.PATCH`）。
- `versionName` 取自 tag（會去掉開頭的 `v`，例如 `v1.0.1` → `1.0.1`）。
- `versionCode` 由 CI 的 `github.run_number` 自動遞增，不需手動指定。
- 發布步驟同時上傳到 Google Play 的 `internal` 與 `beta` 兩個 track。
- 仍可用 `workflow_dispatch` 手動執行，並以 `versionCode` / `versionName` input 覆寫。

發版流程：先把 `main` push 上去（CI checkout 遠端 `main`），再 push tag，例如：

```sh
git tag 1.0.1
git push origin 1.0.1
```
