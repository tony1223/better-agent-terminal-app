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
